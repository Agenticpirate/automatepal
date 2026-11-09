// Team workspaces (043): invites, roles, workspace resolution and isolation. Rollback-only.
// Synthetic principals: owner A, owner B, and A's agent, manager and admin.
import {Client} from 'pg';import fs from 'node:fs';import assert from 'node:assert/strict';import {randomUUID,createHash} from 'node:crypto';
const local=process.env.LOCAL_DATABASE_URL;
const c=local?new Client({connectionString:local}):new Client({host:'aws-0-us-east-1.pooler.supabase.com',port:5432,database:'postgres',user:'postgres.sknmlhjaysqmtyeqpfiv',password:fs.readFileSync(process.env.DATABASE_PASSWORD_FILE!,'utf8'),ssl:{ca:fs.readFileSync('certs/supabase-ca.crt','utf8'),rejectUnauthorized:true}});
const hash=(t:string)=>createHash('sha256').update(t).digest('hex');
let n=0;const ok=()=>{n++;};
async function as(user:string,workspace?:string){await c.query('RESET ROLE');await c.query("select set_config('request.jwt.claim.sub',$1,true)",[user]);await c.query("select set_config('request.headers',$1,true)",[JSON.stringify(workspace?{'x-workspace-id':workspace}:{})]);await c.query('SET LOCAL ROLE authenticated');}
async function rejects(sql:string,args:unknown[],match:RegExp){await c.query('SAVEPOINT x');await assert.rejects(()=>c.query(sql,args),(e:Error)=>match.test(e.message));await c.query('ROLLBACK TO SAVEPOINT x');ok();}
async function count(sql:string,args:unknown[]=[]){return (await c.query(sql,args)).rows[0].n as number;}
async function main(){await c.connect();try{await c.query('BEGIN');
 const A=randomUUID(),B=randomUUID(),agent=randomUUID(),manager=randomUUID(),admin=randomUUID(),stranger=randomUUID();
 const mail=(u:string)=>`${u.slice(0,8)}@team.example.test`;
 for(const u of [A,B,agent,manager,admin,stranger])await c.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())",[u,mail(u)]);
 // Team features need seats: put A on a paid plan (a manual comp) and check that Free allows the owner only.
 assert.equal((await c.query("select (public.workspace_limits($1)->>'seats')::int n",[A])).rows[0].n,1);ok();
 await c.query("select public.set_manual_plan($1,'scale')",[A]);
 const caseA=randomUUID(),caseB=randomUUID();
 await c.query("insert into support_cases(id,user_id,token_hash,expires_at,order_label,amount) values($1,$2,$3,now()+interval '1 hour','Team fixture A',19),($4,$5,$6,now()+interval '1 hour','Team fixture B',19)",[caseA,A,hash(randomUUID()),caseB,B,hash(randomUUID())]);

 // Owner A resolves to their own workspace without a header and with their own id.
 await as(A);assert.deepEqual((await c.query('select * from workspace_context()')).rows[0],{workspace_id:A,role:'owner'});ok();
 await as(A,A);assert.equal((await c.query('select acting_role() r')).rows[0].r,'owner');ok();

 // Invites: owner can invite every role; self/duplicate invites refused.
 const tok={agent:randomUUID(),manager:randomUUID(),admin:randomUUID(),stranger:randomUUID()};
 await as(A);
 await c.query("select create_workspace_invite($1,'agent',$2)",[mail(agent),hash(tok.agent)]);
 await c.query("select create_workspace_invite($1,'manager',$2)",[mail(manager).toUpperCase(),hash(tok.manager)]);
 await c.query("select create_workspace_invite($1,'admin',$2)",[mail(admin),hash(tok.admin)]);ok();
 await rejects("select create_workspace_invite($1,'agent',$2)",[mail(A),hash(randomUUID())],/Already a member/);
 await rejects("select create_workspace_invite($1,'agent',$2)",[mail(agent),hash(randomUUID())],/Invite already pending/);
 await rejects("select create_workspace_invite($1,'owner',$2)",[mail(stranger),hash(randomUUID())],/Insufficient role/);
 await rejects("select create_workspace_invite('not-an-email','agent',$1)",[hash(randomUUID())],/Invalid invite/);
 assert.equal(await count('select count(*)::int n from workspace_pending_invites()'),3);ok();
 // Tables are not directly readable or writable.
 await rejects('select * from workspace_members',[],/permission denied/);
 await rejects("insert into workspace_members(workspace_id,user_id,role) values($1,$2,'admin')",[A,stranger],/permission denied/);

 // Acceptance requires the invited, confirmed email.
 await as(stranger);await rejects('select accept_workspace_invite($1)',[hash(tok.agent)],/Invite unavailable/);
 await as(agent);assert.equal((await c.query('select accept_workspace_invite($1) w',[hash(tok.agent)])).rows[0].w,A);ok();
 await rejects('select accept_workspace_invite($1)',[hash(tok.agent)],/Invite unavailable/);
 await as(manager);await c.query('select accept_workspace_invite($1)',[hash(tok.manager)]);
 await as(admin);await c.query('select accept_workspace_invite($1)',[hash(tok.admin)]);ok();
 assert.equal(await count('select count(*)::int n from my_workspaces()'),2);ok();

 // Header resolution fails closed for non-members and malformed ids.
 await as(agent,A);assert.deepEqual((await c.query('select * from workspace_context()')).rows[0],{workspace_id:A,role:'agent'});ok();
 await as(agent,B);assert.equal((await c.query('select acting_workspace() w')).rows[0].w,null);ok();
 assert.equal(await count('select count(*)::int n from support_cases'),0);ok();
 await as(agent,'not-a-uuid');assert.equal((await c.query('select acting_workspace() w')).rows[0].w,null);ok();
 await as(B,A);assert.equal(await count('select count(*)::int n from support_cases where user_id=$1',[A]),0);ok();
 await as(stranger,A);assert.equal(await count('select count(*)::int n from support_cases'),0);ok();

 // Agent: works tickets, cannot change content, settings, tokens, audit or the team.
 await as(agent,A);
 assert.equal(await count('select count(*)::int n from support_cases where id=$1',[caseA]),1);ok();
 assert.equal(await count('select count(*)::int n from support_cases where id=$1',[caseB]),0);ok();
 assert.equal((await c.query(`select update_tickets(array[$1]::uuid[],'{"priority":"high"}'::jsonb) r`,[caseA])).rows[0].r,1);ok();
 const note=(await c.query("select add_ticket_note($1,'Agent fixture note') id",[caseA])).rows[0].id;
 await c.query('RESET ROLE');assert.equal((await c.query('select actor_id,user_id from ticket_events where id=$1',[note])).rows[0].actor_id,agent);ok();
 await as(agent,A);
 assert.equal((await c.query('select assign_ticket($1,$2) r',[caseA,agent])).rows[0].r,true);ok();
 await rejects('select assign_ticket($1,$2)',[caseA,B],/not on this team/);
 assert.equal((await c.query('select assign_ticket($1,$2) r',[caseB,agent])).rows[0].r,false);ok();
 await rejects("select save_custom_response($1,null,'Agent question fixture','Agent answer fixture',false)",[randomUUID()],/Insufficient role/);
 await rejects("select create_readonly_token('agent token',$1,'support:read',1)",[hash(randomUUID())],/Insufficient role/);
 await rejects("select create_workspace_invite($1,'agent',$2)",[mail(stranger),hash(tok.stranger)],/Insufficient role/);
 await rejects("select delete_preview_data('DELETE MY PREVIEW DATA')",[],/Insufficient role/);
 await rejects("insert into widget_settings(user_id,label,color,initials,prompts) values($1,'Agent','#233de8','AG','[]')",[A],/row-level security/);
 assert.equal(await count('select count(*)::int n from owner_audit_events'),0);ok();
 assert.equal(await count('select count(*)::int n from readonly_tokens'),0);ok();
 assert.equal(await count('select count(*)::int n from operational_events'),0);ok();
 assert.equal(await count('select count(*)::int n from workspace_team()'),4);ok();
 await rejects('select * from workspace_pending_invites()',[],/Insufficient role/);

 // Manager: content and agents; not managers, admins, tokens or audit.
 await as(manager,A);
 await c.query("select save_custom_response($1,null,'Manager fixture question','Manager fixture answer',false)",[randomUUID()]);ok();
 await c.query("insert into widget_settings(user_id,label,color,initials,prompts) values($1,'Manager','#233de8','MG','[]')",[A]);ok();
 await c.query("select create_workspace_invite($1,'agent',$2)",[mail(stranger),hash(tok.stranger)]);ok();
 await rejects("select create_workspace_invite($1,'manager',$2)",[`x${mail(stranger)}`,hash(randomUUID())],/Insufficient role/);
 await rejects("select set_member_role($1,'manager')",[agent],/Insufficient role/);
 await rejects("select create_readonly_token('manager token',$1,'support:read',1)",[hash(randomUUID())],/Insufficient role/);
 await rejects('select remove_member($1)',[admin],/Insufficient role/);
 assert.equal(await count('select count(*)::int n from owner_audit_events'),0);ok();

 // Admin: tokens, managers and agents; cannot touch admins, the owner, or delete workspace data.
 await as(admin,A);
 await c.query("select create_readonly_token('admin token',$1,'support:read',1)",[hash(randomUUID())]);ok();
 assert.equal((await c.query("select set_member_role($1,'manager') r",[agent])).rows[0].r,true);ok();
 assert.equal((await c.query("select set_member_role($1,'agent') r",[agent])).rows[0].r,true);ok();
 await rejects("select set_member_role($1,'admin')",[agent],/Insufficient role/);
 await rejects("select set_member_role($1,'agent')",[admin],/Invalid role change/);
 await rejects("select delete_preview_data('DELETE MY PREVIEW DATA')",[],/Insufficient role/);
 const audit=(await c.query("select count(*)::int n, count(actor_id) filter (where actor_id=$1)::int byadmin from owner_audit_events",[admin])).rows[0];
 assert.ok(audit.n>0&&audit.byadmin>0,'admin sees audit with actor');ok();

 // Owner: manages admins; removal clears assignments; members can leave.
 await as(A);
 assert.equal((await c.query("select set_member_role($1,'manager') r",[admin])).rows[0].r,true);ok();
 assert.equal((await c.query("select set_member_role($1,'admin') r",[admin])).rows[0].r,true);ok();
 assert.equal((await c.query('select remove_member($1) r',[agent])).rows[0].r,true);ok();
 assert.equal((await c.query('select assignee_id from support_cases where id=$1',[caseA])).rows[0].assignee_id,null);ok();
 await as(agent,A);assert.equal((await c.query('select acting_workspace() w')).rows[0].w,null);ok();
 await as(manager);assert.equal((await c.query('select leave_workspace($1) r',[A])).rows[0].r,true);ok();
 await rejects('select leave_workspace($1)',[manager],/cannot leave/);
 await as(A);assert.equal(await count('select count(*)::int n from workspace_team()'),2);ok();

 // Revoked invites cannot be accepted.
 const inv=(await c.query("select id from workspace_pending_invites() where email=$1",[mail(stranger)])).rows[0].id;
 assert.equal((await c.query('select revoke_workspace_invite($1) r',[inv])).rows[0].r,true);ok();
 await as(stranger);await rejects('select accept_workspace_invite($1)',[hash(tok.stranger)],/Invite unavailable/);

 // Owner B is untouched and sees nothing of A.
 await as(B);assert.equal(await count('select count(*)::int n from workspace_team()'),1);ok();
 assert.equal(await count('select count(*)::int n from support_cases where id=$1',[caseA]),0);ok();
 assert.equal(await count('select count(*)::int n from custom_responses'),0);ok();

 // Seat cap: the plan's seats (db/057; A is on Scale here, 10 seats) including the owner and open invites.
 await c.query('RESET ROLE');
 const free=(await c.query("select (public.workspace_limits($1)->>'seats')::int-public.workspace_seat_count($1) n",[A])).rows[0].n;
 for(let i=0;i<free;i++){const u=randomUUID();await c.query("insert into auth.users(id,email,email_confirmed_at) values($1,$2,now())",[u,`seat${i}@team.example.test`]);await c.query("insert into workspace_members(workspace_id,user_id,role) values($1,$2,'agent')",[A,u]);}
 await as(A);await rejects("select create_workspace_invite('overflow@team.example.test','agent',$1)",[hash(randomUUID())],/Seat limit reached/);

 // Owner-only deletion also removes the team.
 await as(A);await c.query("select delete_preview_data('DELETE MY PREVIEW DATA')");
 await c.query('RESET ROLE');assert.equal(await count('select count(*)::int n from workspace_members where workspace_id=$1',[A]),0);ok();
 assert.equal(await count('select count(*)::int n from workspace_invites where workspace_id=$1',[A]),0);ok();
 console.log(`PASS team DB: ${n} checks; invites by role, email-bound acceptance, header resolution fails closed, agent/manager/admin/owner matrix, actor stamping, assignment, removal/leave, seat cap, cross-tenant isolation, owner-only deletion; rollback only.`);
}finally{await c.query('ROLLBACK');await c.end();}}
main().catch(e=>{console.error(e.message);process.exitCode=1});
