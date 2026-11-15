/**
 * Facts for the "technology" section. Every entry was checked against the source it cites
 * (FDA records were read from accessdata.fda.gov on 14 November 2026). Add a claim only with
 * a source that states it; "cleared" (510(k)) and "De Novo granted" are different things and
 * neither is "approved".
 */

export interface Source {
  id: number;
  label: string;
  href: string;
}

export const SOURCES: Source[] = [
  {
    id: 1,
    label: 'Verkruysse, Svaasand and Nelson, "Remote plethysmographic imaging using ambient light", Optics Express 16(26), 2008',
    href: 'https://doi.org/10.1364/OE.16.021434',
  },
  {
    id: 2,
    label: 'FDA De Novo database, DEN200019, Oxehealth Vital Signs, granted 26 March 2021 (21 CFR 870.2785, product code QME)',
    href: 'https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfpmn/denovo.cfm?id=DEN200019',
  },
  {
    id: 3,
    label: 'FDA 510(k) database, K223622, FaceHeart Vitals Software Development Kit, 1 September 2023',
    href: 'https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfPMN/pmn.cfm?ID=K223622',
  },
  {
    id: 4,
    label: 'FDA 510(k) database, K241633, Informed Vital Core Application, 18 November 2024',
    href: 'https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfPMN/pmn.cfm?ID=K241633',
  },
  {
    id: 5,
    label: 'FDA 510(k) database, K240890, PanopticAI Vital Signs, 23 December 2024',
    href: 'https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfPMN/pmn.cfm?ID=K240890',
  },
  {
    id: 6,
    label: 'FDA 510(k) database, K253650, Anura Mobile Core SDK (M1), 11 June 2026',
    href: 'https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfPMN/pmn.cfm?ID=K253650',
  },
  {
    id: 7,
    label: 'FDA 510(k) database, K254169, SmartSpectra Vital Signs Monitor 1.0, 18 June 2026',
    href: 'https://www.accessdata.fda.gov/scripts/cdrh/cfdocs/cfPMN/pmn.cfm?ID=K254169',
  },
  {
    id: 8,
    label: 'Globes, "Israeli health monitoring co Binah.ai raises $13.5m", 10 June 2020',
    href: 'https://en.globes.co.il/en/article-israeli-health-monitoring-co-binahai-raises-135m-1001331954',
  },
  {
    id: 9,
    label: 'BioSpace, "Mindset Medical, Inc Raises Funds to Continue Development and Clinical Trials for Informed Vital Core", June 2024',
    href: 'https://www.biospace.com/mindset-medical-inc-raises-funds-to-continue-development-and-clinical-trials-for-informed-vital-core',
  },
];

export interface Decision {
  date: string;
  year: string;
  product: string;
  company: string;
  /** The FDA's decision, in its own terms. */
  decision: 'De Novo granted' | '510(k) cleared';
  number: string;
  source: number;
}

/**
 * Each company's first FDA decision for a contact-free camera product under 21 CFR 870.2785
 * (product code QME), in date order. Later clearances for the same companies and the one
 * fingertip-contact product in the code (FibriCheck, K232804) are left out.
 */
export const DECISIONS: Decision[] = [
  { date: '26 Mar', year: '2021', product: 'Oxehealth Vital Signs', company: 'Oxehealth', decision: 'De Novo granted', number: 'DEN200019', source: 2 },
  { date: '1 Sep', year: '2023', product: 'FaceHeart Vitals SDK', company: 'FaceHeart', decision: '510(k) cleared', number: 'K223622', source: 3 },
  { date: '18 Nov', year: '2024', product: 'Informed Vital Core', company: 'Mindset Medical', decision: '510(k) cleared', number: 'K241633', source: 4 },
  { date: '23 Dec', year: '2024', product: 'PanopticAI Vital Signs', company: 'PanopticAI', decision: '510(k) cleared', number: 'K240890', source: 5 },
  { date: '11 Jun', year: '2026', product: 'Anura Mobile Core SDK', company: 'NuraLogix', decision: '510(k) cleared', number: 'K253650', source: 6 },
  { date: '18 Jun', year: '2026', product: 'SmartSpectra Vital Signs Monitor', company: 'Presage Technologies', decision: '510(k) cleared', number: 'K254169', source: 7 },
];

export interface Backer {
  company: string;
  fact: string;
  source: number;
}

export const BACKERS: Backer[] = [
  {
    company: 'Binah.ai',
    fact: 'Raised a $13.5 million Series B in 2020, led by Maverick Ventures, for vital signs measured with a smartphone camera',
    source: 8,
  },
  {
    company: 'Mindset Medical',
    fact: 'Announced a Series A in June 2024 led by Grayhawk Capital and Questa Capital, with Amgen Ventures taking part, and was cleared five months later',
    source: 9,
  },
];
