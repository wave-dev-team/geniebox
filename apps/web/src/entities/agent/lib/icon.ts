import {
  BarChart3,
  Bot,
  CheckCircle2,
  Code2,
  Coins,
  FileText,
  Handshake,
  Headphones,
  type LucideIcon,
  Mail,
  PenLine,
  Radar,
  Search,
  Server,
  ShieldCheck,
  Sparkles,
  Ticket,
  TrendingUp,
  WandSparkles,
} from 'lucide-react';

export const AGENT_GLYPH_MAP: Record<string, LucideIcon> = {
  growth: TrendingUp,
  content: PenLine,
  mail: Mail,
  search: Search,
  partner: Handshake,
  support: Headphones,
  ticket: Ticket,
  star: Sparkles,
  chart: BarChart3,
  money: Coins,
  radar: Radar,
  server: Server,
  code: Code2,
  check: CheckCircle2,
  shield: ShieldCheck,
  doc: FileText,
  bot: Bot,
};

export function resolveAgentGlyph(glyph: string, kind?: 'manager' | 'agent'): LucideIcon {
  if (kind === 'manager') return WandSparkles;
  return AGENT_GLYPH_MAP[glyph] ?? Bot;
}
