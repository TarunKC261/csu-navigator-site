'use client';

/**
 * Icon shim — re-exports @tabler/icons-react under Lucide-compatible names.
 *
 * Why: lucide-react is not approved under our license policy. Tabler Icons
 * (MIT) is the drop-in replacement. This module preserves the exact prop
 * surface and visual weight of the previous Lucide build:
 *   - 24×24 outline icons, default stroke 2 (matches Lucide default).
 *   - Lucide's `strokeWidth` prop is mapped to Tabler's `stroke` prop.
 *   - All other props (size, color, className, style, SVG attrs) pass through.
 *
 * Consumers import from `@/lib/icons` instead of `lucide-react`; symbol names
 * are unchanged so no further code edits are required.
 */

import { forwardRef, createElement } from 'react';
import type {
  ForwardRefExoticComponent,
  RefAttributes,
  SVGProps,
} from 'react';
import {
  IconActivity,
  IconAlertCircle,
  IconAlertTriangle,
  IconArrowRight,
  IconBolt,
  IconBook,
  IconCalendar,
  IconCalendarMonth,
  IconCheck,
  IconChevronDown,
  IconChevronUp,
  IconCircle,
  IconCircleCheck,
  IconCirclePlus,
  IconClick,
  IconClock,
  IconCloud,
  IconCopy,
  IconEdit,
  IconExternalLink,
  IconFileText,
  IconHash,
  IconHelpCircle,
  IconHistory,
  IconLayout,
  IconLink,
  IconListCheck,
  IconLock,
  IconLogout,
  IconMail,
  IconMessageCircle,
  IconShieldCheck,
  IconMicrophone,
  IconMicrophoneOff,
  IconPower,
  IconRadio,
  IconRefresh,
  IconRobot,
  IconSearch,
  IconSend,
  IconSparkles,
  IconTag,
  IconTool,
  IconTrendingUp,
  IconUser,
  IconUsers,
  IconX,
  type Icon as TablerIcon,
} from '@tabler/icons-react';

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'stroke'> {
  /** Pixel size (Lucide default 24). */
  size?: number | string;
  /** Tabler-native stroke width. */
  stroke?: number | string;
  /** Lucide-compatible alias — mapped to `stroke` if `stroke` is absent. */
  strokeWidth?: number | string;
  color?: string;
}

export type IconComponent = ForwardRefExoticComponent<
  IconProps & RefAttributes<SVGSVGElement>
>;

function wrap(Cmp: TablerIcon, name: string): IconComponent {
  const W = forwardRef<SVGSVGElement, IconProps>(function LucideShim(
    { strokeWidth, stroke, size = 24, ...rest },
    ref,
  ) {
    return createElement(Cmp as never, {
      ref,
      size,
      stroke: stroke ?? strokeWidth ?? 2,
      ...rest,
    });
  });
  W.displayName = name;
  return W;
}

// Lucide-name → Tabler component (chosen for closest visual parity).
export const Activity = wrap(IconActivity, 'Activity');
export const AlertCircle = wrap(IconAlertCircle, 'AlertCircle');
export const AlertTriangle = wrap(IconAlertTriangle, 'AlertTriangle');
export const ArrowRight = wrap(IconArrowRight, 'ArrowRight');
export const BookOpen = wrap(IconBook, 'BookOpen');
export const Bot = wrap(IconRobot, 'Bot');
export const Calendar = wrap(IconCalendar, 'Calendar');
export const CalendarDays = wrap(IconCalendarMonth, 'CalendarDays');
export const Check = wrap(IconCheck, 'Check');
export const CheckCircle2 = wrap(IconCircleCheck, 'CheckCircle2');
export const ChevronDown = wrap(IconChevronDown, 'ChevronDown');
export const ChevronUp = wrap(IconChevronUp, 'ChevronUp');
export const Circle = wrap(IconCircle, 'Circle');
export const Clock = wrap(IconClock, 'Clock');
export const Cloud = wrap(IconCloud, 'Cloud');
export const Copy = wrap(IconCopy, 'Copy');
export const Edit3 = wrap(IconEdit, 'Edit3');
export const ExternalLink = wrap(IconExternalLink, 'ExternalLink');
export const FileText = wrap(IconFileText, 'FileText');
export const Hash = wrap(IconHash, 'Hash');
export const HelpCircle = wrap(IconHelpCircle, 'HelpCircle');
export const History = wrap(IconHistory, 'History');
export const LayoutTemplate = wrap(IconLayout, 'LayoutTemplate');
export const Link2 = wrap(IconLink, 'Link2');
export const ListChecks = wrap(IconListCheck, 'ListChecks');
export const Lock = wrap(IconLock, 'Lock');
export const LogOut = wrap(IconLogout, 'LogOut');
export const MessageCircle = wrap(IconMessageCircle, 'MessageCircle');
export const Mail = wrap(IconMail, 'Mail');
export const ShieldCheck = wrap(IconShieldCheck, 'ShieldCheck');
export const Mic = wrap(IconMicrophone, 'Mic');
export const MicOff = wrap(IconMicrophoneOff, 'MicOff');
export const MousePointerClick = wrap(IconClick, 'MousePointerClick');
export const PlusCircle = wrap(IconCirclePlus, 'PlusCircle');
export const PowerOff = wrap(IconPower, 'PowerOff');
export const Radio = wrap(IconRadio, 'Radio');
export const RefreshCw = wrap(IconRefresh, 'RefreshCw');
export const Search = wrap(IconSearch, 'Search');
export const Send = wrap(IconSend, 'Send');
export const Sparkles = wrap(IconSparkles, 'Sparkles');
export const Tag = wrap(IconTag, 'Tag');
export const TrendingUp = wrap(IconTrendingUp, 'TrendingUp');
export const User = wrap(IconUser, 'User');
export const Users = wrap(IconUsers, 'Users');
export const Wrench = wrap(IconTool, 'Wrench');
export const X = wrap(IconX, 'X');
export const Zap = wrap(IconBolt, 'Zap');

/** Lookup table used by `getIcon` for legacy Lucide-style names. */
export const IconRegistry: Record<string, IconComponent> = {
  Activity,
  AlertCircle,
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Bot,
  Calendar,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  Clock,
  Cloud,
  Copy,
  Edit3,
  ExternalLink,
  FileText,
  Hash,
  HelpCircle,
  History,
  LayoutTemplate,
  Link2,
  ListChecks,
  Lock,
  LogOut,
  Mail,
  MessageCircle,
  Mic,
  MicOff,
  MousePointerClick,
  PlusCircle,
  PowerOff,
  Radio,
  RefreshCw,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  Tag,
  TrendingUp,
  User,
  Users,
  Wrench,
  X,
  Zap,
};

/** Back-compat type alias for code that previously imported `LucideIcon`. */
export type LucideIcon = IconComponent;
