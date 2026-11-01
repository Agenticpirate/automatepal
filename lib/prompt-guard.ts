/* Visitor-chat prompt-injection guard. Runs in the widget before a question is sent and again on the server
   before any model call or question budget. It refuses three things only:
   - a message that carries its own system prompt (a "System:" / "[SYSTEM]" line that gives the bot a role or
     rules, chat-template tokens such as <|im_start|>, [INST] or <<SYS>>, or "you are now ..." role swaps);
   - a pasted chat transcript (role-labelled lines from both a user and an assistant);
   - a request to ignore, forget or override the bot's instructions.
   Ordinary questions that mention instructions, systems, rules or prompts pass: the patterns need an
   imperative aimed at the bot's own instructions or a role-labelled line, not the words alone.
   Deterministic, no model call. Not a complete defence: the answer prompt also tells the model to treat the
   question as data and never show, translate or rewrite its instructions (lib/knowledge.ts, lib/llm.ts). */
export const PROMPT_INJECTION_REFUSAL = "This message can't be sent. Please rephrase your question.";
export type PromptInjectionKind = 'system_prompt' | 'transcript' | 'ignore_instructions';

const TEMPLATE_TOKENS = /<\|(?:im_start|im_end|system|user|assistant|endoftext)\|>|\[\/?INST\]|<<\/?SYS>>|<\/?(?:system|system_prompt|instructions)>|\[(?:SYSTEM|SYSTEM PROMPT)\]/i;
// A role line that sets up the bot, e.g. "System: You are a pirate" or "### Developer message: always ...".
const SYSTEM_LINE = /^[ \t>*#-]*\**\s*(?:system|developer)(?:\s+(?:prompt|message|instructions?|note))?\s*\**\s*:\s*(?:you\b|you're\b|act\b|your\s+(?:role|task|job|goal|instructions)|from now on\b|always\b|never\b|respond\b|reply\b|answer\b|ignore\b|forget\b|follow\b|do not\b|don't\b|new\s+(?:rules|instructions)|the\s+assistant\b)/im;
const ROLE_SWAP = /\byou\s+are\s+(?:now|no\s+longer)\s+(?:an?\s+)?(?:dan\b|jailbroken|unrestricted|unfiltered|uncensored|in\s+(?:developer|god|debug|admin)\s+mode|free\s+from|not\s+(?:bound|restricted)|a\s+different\s+(?:ai|assistant|bot|model))|\bfrom\s+now\s+on,?\s+you\s+(?:(?:will|must|should|shall)\s+)?(?:act|respond|reply|answer|behave|ignore|only\s+(?:respond|reply|answer)|be\s+(?:an?\s+)?(?:unrestricted|unfiltered|uncensored|dan\b|different))|\bnew\s+system\s+(?:prompt|instructions?)\s*:|\bpretend\s+(?:that\s+)?you\s+(?:are|have)\s+no\s+(?:rules|instructions|restrictions|guidelines)|\b(?:enable|enter|activate)\s+(?:developer|god|debug|jailbreak|dan)\s+mode\b/i;
// Transcript lines: both a user-side and an assistant-side label at the start of lines.
const USER_LABEL = /^[ \t>*-]*\**\s*(?:user|human|me|customer|visitor)\s*\**\s*:/im;
const BOT_LABEL = /^[ \t>*-]*\**\s*(?:assistant|ai|ai\s+assistant|bot|chatbot|chatgpt|gpt(?:-\d)?|claude|gemini|system|support\s+bot)\s*\**\s*:/im;
// "Ignore (all) (of) (your|the) previous instructions", "disregard the rules above", "forget everything you were told".
const QUAL = '(?:(?:all|any|every|of|your|the|these|those|its|previous|prior|above|earlier|preceding|initial|original|existing|current|system|bot\'?s|assistant\'?s|other|default|safety)\\s+){0,5}';
const TARGET = '(?:instructions?|rules|prompts?|guidelines|directives|directions|guardrails|programming|restrictions|constraints|system\\s+(?:prompt|message)|context)';
const IGNORE_AT_START = new RegExp(`(?:^|[.!?;:\\n]\\s*|\\b(?:please|now)\\s+)(?:ignore|disregard|forget|override|bypass|skip|drop|discard)\\s+${QUAL}${TARGET}\\b`, 'im');
const IGNORE_BOT_RULES = new RegExp(`\\b(?:ignore|disregard|forget|override|bypass|discard)\\s+(?:(?:all|any|every|of)\\s+)*(?:(?:your|the|its|these|those)\\s+)?(?:previous|prior|above|earlier|preceding|initial|original|system|bot'?s|assistant'?s|safety)\\s+${QUAL}${TARGET}\\b`, 'i');
const IGNORE_YOUR = /\b(?:ignore|disregard|forget|override|bypass)\s+(?:all\s+(?:of\s+)?)?(?:your|its)\s+(?:own\s+)?(?:instructions|rules|prompt|programming|guidelines|guardrails|restrictions|system\s+prompt)\b|\b(?:i\s+want|i\s+need)\s+you\s+to\s+(?:ignore|disregard|forget)\s+(?:your|the|all)\b|\bforget\s+(?:everything|all)\s+(?:you\s+(?:were|have\s+been)\s+told|above|before|previously)\b|\bdo\s+not\s+follow\s+(?:your|the|any)\s+(?:previous\s+|prior\s+|system\s+)?(?:instructions|rules|prompt)\b/i;

export function promptInjectionKind(text: string): PromptInjectionKind | null {
  const t = String(text ?? '').normalize('NFKC').replace(/[\u200B-\u200D\u2060\uFEFF]/g, '');
  if (TEMPLATE_TOKENS.test(t) || SYSTEM_LINE.test(t) || ROLE_SWAP.test(t)) return 'system_prompt';
  if (USER_LABEL.test(t) && BOT_LABEL.test(t)) return 'transcript';
  if (IGNORE_AT_START.test(t) || IGNORE_BOT_RULES.test(t) || IGNORE_YOUR.test(t)) return 'ignore_instructions';
  return null;
}
export const promptInjection = (text: string) => promptInjectionKind(text) !== null;
