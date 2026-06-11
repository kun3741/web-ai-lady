import { Context, SessionFlavor } from 'grammy';

/** Session data stored per admin chat */
export interface SessionData {
  activePersonaId?: string;
  activeCandidateId?: string;
  panelMessageId?: number;
  awaitingInput?: string;
  /** Temp fields for multi-step creation flows */
  selectedPersonaId?: string;
  pendingLeadName?: string;
  pendingPersonaName?: string;
  /** Import flow */
  awaitingImportPersonaId?: string;
  /** Bridge auth flow */
  bridgePersonaId?: string;
  bridgePendingApiId?: number;
  bridgePendingApiHash?: string;
  bridgePendingPhone?: string;
}

export type BotContext = Context & SessionFlavor<SessionData>;

export const BOT_INSTANCE = 'BOT_INSTANCE';
