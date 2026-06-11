import { FunnelStage } from './schemas/funnel-stage-state.schema';

export interface StageConfig {
  label: string;
  emoji: string;
  objective: string;
  suggestedActions: string[];
  safetyWarnings: string[];
  allowedTransitions: FunnelStage[];
}

export const FUNNEL_STAGE_CONFIG: Record<FunnelStage, StageConfig> = {
  new: {
    label: 'New',
    emoji: '🆕',
    objective: 'Initial contact established. Qualify the lead and build basic rapport.',
    suggestedActions: ['Ask about their interests', 'Share basic info', 'Be warm and welcoming'],
    safetyWarnings: [],
    allowedTransitions: ['intro', 'archived'],
  },
  intro: {
    label: 'Introduction',
    emoji: '👋',
    objective: 'Exchange basic information, photos, and establish communication rhythm.',
    suggestedActions: ['Exchange photos', 'Ask about work/life', 'Establish common interests'],
    safetyWarnings: [],
    allowedTransitions: ['rapport', 'cooled', 'archived'],
  },
  rapport: {
    label: 'Building Rapport',
    emoji: '💬',
    objective: 'Deepen the connection through meaningful conversation and shared experiences.',
    suggestedActions: ['Share stories', 'Voice messages', 'Suggest video call'],
    safetyWarnings: [],
    allowedTransitions: ['deepening', 'intro', 'cooled', 'archived'],
  },
  deepening: {
    label: 'Deepening',
    emoji: '💕',
    objective: 'Video calls done, building emotional connection and trust.',
    suggestedActions: ['Regular video calls', 'Discuss future plans', 'Share more personal info'],
    safetyWarnings: ['Monitor for premature financial discussions'],
    allowedTransitions: ['planning', 'rapport', 'cooled', 'archived'],
  },
  planning: {
    label: 'Planning Meeting',
    emoji: '🗓️',
    objective: 'Actively planning a real-world meeting.',
    suggestedActions: ['Discuss travel logistics', 'Set dates', 'Plan activities'],
    safetyWarnings: [
      '⚠️ Travel/money topics require manual review',
      '⚠️ Never auto-generate financial requests',
    ],
    allowedTransitions: ['met', 'deepening', 'cooled', 'archived'],
  },
  met: {
    label: 'Met in Person',
    emoji: '🤝',
    objective: 'Post-meeting: maintain connection and evaluate relationship.',
    suggestedActions: ['Follow up on meeting', 'Share memories', 'Discuss next steps'],
    safetyWarnings: [],
    allowedTransitions: ['ongoing', 'cooled', 'archived'],
  },
  ongoing: {
    label: 'Ongoing Relationship',
    emoji: '❤️',
    objective: 'Maintain and grow the established relationship.',
    suggestedActions: ['Regular check-ins', 'Plan future meetings', 'Support and encourage'],
    safetyWarnings: [],
    allowedTransitions: ['cooled', 'archived'],
  },
  cooled: {
    label: 'Cooled Down',
    emoji: '❄️',
    objective: 'Communication has slowed. Evaluate if re-engagement is appropriate.',
    suggestedActions: ['Send a casual check-in', 'Wait for them to initiate'],
    safetyWarnings: ['Respect their space — do not over-pursue'],
    allowedTransitions: ['intro', 'rapport', 'archived'],
  },
  archived: {
    label: 'Archived',
    emoji: '📦',
    objective: 'Contact is archived. No active communication.',
    suggestedActions: [],
    safetyWarnings: [],
    allowedTransitions: ['new'],
  },
};
