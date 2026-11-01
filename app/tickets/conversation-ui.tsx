'use client';
import {BotMark, ProfileMark} from '../components/home/BotMark';
import type {Ticket} from '../../lib/tickets';
import {aiPaused, cap} from './inbox-ui';

/* Conversation pieces for the owner inbox: participant avatars (our own BotMark and ProfileMark mascots),
   the header chip that names the AI assistant, the owner and the visitor, the empty-state mascot cluster,
   a one-line row preview and browser-local pins (per browser). Built in-house; no third-party template code. */

export function Avatar({who, size = 28}: {who: 'ai' | 'owner' | 'visitor'; size?: number}) {
  return <span className={'ap-ib-pav is-' + who} style={{width: size, height: size}} aria-hidden="true">
    {who === 'ai' ? <BotMark size={size}/> : <ProfileMark size={size} tone={who === 'owner' ? 'owner' : 'visitor'}/>}
  </span>;
}

/* Who is in this conversation and whether the AI is answering. The paused state stays visible. */
export function Participants({t}: {t: Ticket}) {
  const paused = aiPaused(t), takenOver = t.inbox_state === 'taken_over';
  const label = `Participants: AI assistant (${paused ? 'paused' : 'answering'}), owner (${takenOver ? 'replying in the widget' : 'watching'}), visitor`;
  return <div className={'ap-ib-people' + (paused ? ' paused' : '')} role="group" aria-label={label}>
    <span className="ap-ib-people-av">
      <span className={'ap-ib-people-ai' + (paused ? ' off' : '')}><Avatar who="ai" size={24}/></span>
      <Avatar who="owner" size={24}/>
      <Avatar who="visitor" size={24}/>
    </span>
    <span className="ap-ib-people-t">
      <b>AI assistant, owner, visitor</b>
      <small>{takenOver ? 'Taken over · AI paused' : paused ? 'Closed · AI paused' : 'AI answering from sources'}</small>
    </span>
  </div>;
}

export function MascotCluster() {
  return <span className="ap-ib-cluster" aria-hidden="true">
    <span className="ap-ib-cluster-a"><ProfileMark size={40} tone="owner"/></span>
    <span className="ap-ib-cluster-b"><BotMark size={64}/></span>
    <span className="ap-ib-cluster-c"><ProfileMark size={40}/></span>
  </span>;
}

/* Who is handling the conversation right now, for the row avatar. */
export const handler = (t: Ticket): 'ai' | 'owner' => t.inbox_state === 'taken_over' ? 'owner' : 'ai';

/* One muted line under the row title, derived from ticket fields only (no message text in the list). */
export function rowPreview(t: Ticket): string {
  if (t.inbox_state === 'taken_over') return 'Owner took over. AI paused; replies go to the widget.';
  if (['resolved', 'closed'].includes(t.ticket_status)) return 'Conversation finished. AI paused.';
  if (t.category === 'handoff') return 'Visitor asked for a person.';
  if (t.category === 'refund') return t.review_decision === 'pending' ? 'Refund review pending. Nothing executes.' : 'Refund question for owner review.';
  if (t.inbox_state === 'attention') return 'Needs attention from the owner.';
  return `${['question', 'general', ''].includes(t.category) ? 'General' : cap(t.category)} question. AI answers from sources.`;
}

const PIN_KEY = 'ap-ib-pins';
/* Pins are per browser (localStorage), not shared with the team. Call only from effects or handlers. */
export function readPins(): string[] {
  try { const v = JSON.parse(localStorage.getItem(PIN_KEY) ?? '[]'); return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string').slice(0, 50) : []; } catch { return []; }
}
export function writePins(ids: string[]) { try { localStorage.setItem(PIN_KEY, JSON.stringify(ids.slice(0, 50))); } catch {} }
