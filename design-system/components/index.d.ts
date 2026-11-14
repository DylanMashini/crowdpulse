import type * as React from 'react';

export type TileState = 'observed' | 'flag' | 'overdue' | 'no-reading';
export type Provenance = 'live' | 'recording' | 'experimental' | 'ai-draft' | 'reference';
export type IconName = 'clock' | 'flag' | 'check' | 'bell' | 'camera' | 'lock' | 'no-reading' | 'pulse' | 'breath' | 'list' | 'sliders' | 'chart' | 'ticket' | 'draft' | 'trash' | 'scan' | 'user' | 'video' | 'thermal' | 'chevron' | 'eye-off';
/** A value against the patient's own check-in baseline. `now: null` means no reading. */
export interface Trend { base?: number | null; now: number | null }

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> { variant?: 'primary' | 'secondary' | 'quiet' | 'danger'; size?: 'md' | 'touch'; icon?: IconName; block?: boolean }
export declare function Button(props: ButtonProps): React.ReactElement;
export interface SwitchProps { label: string; hint?: string; checked?: boolean; disabled?: boolean; onChange?: (next: boolean) => void }
export declare function Switch(props: SwitchProps): React.ReactElement;
export interface FieldProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'size'> { label: string; unit?: string; hint?: string; error?: string; size?: 'md' | 'touch' }
export declare function Field(props: FieldProps): React.ReactElement;
export interface IconProps { name: IconName; size?: 16 | 18 | 20 | 24; label?: string; className?: string }
export declare function Icon(props: IconProps): React.ReactElement;

export interface StatusBadgeProps { state: TileState; minutes?: number; children?: React.ReactNode }
export declare function StatusBadge(props: StatusBadgeProps): React.ReactElement;
export interface ProvenanceTagProps { kind: Provenance; children?: React.ReactNode }
export declare function ProvenanceTag(props: ProvenanceTagProps): React.ReactElement;
export interface ScoreChipProps { score: 0 | 1 | 2 | 3; measured?: number; caption?: boolean }
export declare function ScoreChip(props: ScoreChipProps): React.ReactElement;
export interface QualityMeterProps { value: number; label?: string; threshold?: number }
export declare function QualityMeter(props: QualityMeterProps): React.ReactElement;

export interface ReadoutProps { label: string; value?: number | string; unit?: string; size?: 'xl' | 'lg' | 'md'; state?: 'valid' | 'settling' | 'none' | 'stale'; icon?: IconName; age?: string; reason?: string; tag?: Provenance }
export declare function Readout(props: ReadoutProps): React.ReactElement;
export interface TicketNumberProps { number: number | string; size?: 'sm' | 'md' | 'lg' | 'xl' }
export declare function TicketNumber(props: TicketNumberProps): React.ReactElement;
export interface HandoffNoteProps { children: React.ReactNode; draft?: string; draftState?: 'ready' | 'withheld' | 'unavailable' | 'none' }
export declare function HandoffNote(props: HandoffNoteProps): React.ReactElement;
export interface PrivacyNoteProps { children: React.ReactNode; icon?: IconName; tone?: 'filled' | 'plain' }
export declare function PrivacyNote(props: PrivacyNoteProps): React.ReactElement;

export interface SideNavItem { id: string; label: string; icon: IconName; count?: number }
export interface SideNavProps { items: SideNavItem[]; active?: string; onSelect?: (id: string) => void; title?: string; footer?: React.ReactNode }
export declare function SideNav(props: SideNavProps): React.ReactElement;
export interface WorklistRow { ticket: number; state: TileState; minutes?: number; pulse?: Trend; breathing?: Trend; score?: 0 | 1 | 2 | 3 | null; source?: Provenance }
export interface WorklistTableProps { rows: WorklistRow[]; selected?: number; onSelect?: (ticket: number) => void }
export declare function WorklistTable(props: WorklistTableProps): React.ReactElement;
export interface PatientTileProps extends WorklistRow {}
export declare function PatientTile(props: PatientTileProps): React.ReactElement;
export interface ReferenceChartProps { estimate: Array<number | null>; reference: Array<number | null>; referenceName?: string; title?: string; width?: number; height?: number }
export declare function ReferenceChart(props: ReferenceChartProps): React.ReactElement;
export interface TimelineItem { time: string; title: string; pulse?: number | null; breathing?: number | null; score?: 0 | 1 | 2 | 3; state?: TileState; source?: Provenance; note?: string }
export interface TicketTimelineProps { items: TimelineItem[] }
export declare function TicketTimeline(props: TicketTimelineProps): React.ReactElement;

export interface WorklistCardProps extends WorklistRow { rank: number; onPress?: () => void }
export declare function WorklistCard(props: WorklistCardProps): React.ReactElement;
export interface PushBannerProps { ticket: number; time?: string; title?: string; children: React.ReactNode; acknowledged?: boolean; by?: string; onAcknowledge?: () => void; onOpen?: () => void }
export declare function PushBanner(props: PushBannerProps): React.ReactElement;
export interface Role { id: string; icon: IconName; label: string; hint: string }
export interface RolePickerProps { value?: string; onChange?: (id: string) => void; roles?: Role[] }
export declare function RolePicker(props: RolePickerProps): React.ReactElement;

export interface ViewfinderProps { state?: 'searching' | 'locking' | 'measuring' | 'lost'; children?: React.ReactNode }
export declare function Viewfinder(props: ViewfinderProps): React.ReactElement;
export interface SittingTimerProps { elapsed: number; total?: number; phases?: Array<{ until: number; label: string }> }
export declare function SittingTimer(props: SittingTimerProps): React.ReactElement;
export interface CaptureStatusProps { fps?: number; dropped?: number; exposureLocked?: boolean; thermal?: string; note?: string }
export declare function CaptureStatus(props: CaptureStatusProps): React.ReactElement;
export interface SummaryItem { label: string; icon?: IconName; value: number | null; unit?: string; coverage?: number; threshold?: number; experimental?: boolean; reason?: string }
export interface SittingSummaryProps { ticket: number; items: SummaryItem[]; theme?: 'light' | 'dark'; children?: React.ReactNode }
export declare function SittingSummary(props: SittingSummaryProps): React.ReactElement;
export interface ConsentSheetProps { ticket: number; title?: string; onAccept?: () => void; onDecline?: () => void }
export declare function ConsentSheet(props: ConsentSheetProps): React.ReactElement;
