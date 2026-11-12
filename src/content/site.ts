// Every visible string on the page. All copy is approved (2026-11-09); a new unconfirmed line
// goes through draft() from ./draft.ts with its source. Never invent numbers, dates or
// credentials: if a value is not in the sources, leave it out.
import type { Copy } from './draft.ts';

export const SITE = {
  name: 'Guillermo Campollo',
  brand: 'ermocodes',
  url: 'https://ermocodes.com',
  email: 'hello@ermocodes.com',
  title: 'Guillermo Campollo · Backend engineer',
  description:
    'Guillermo Campollo, backend engineer. Python, APIs, queues and data, from startups to big companies. Guadalajara, MX. Remote. Open to freelance.',
  jobTitle: 'Backend engineer',
  location: 'Guadalajara, MX',
} as const;

export const NAV_CTA = 'contact';
/** Header link to the studio section (founder decision 2026-11-11). */
export const NAV_STUDIO = 'work with me';

/** The header's motion control (WCAG 2.2.2): shown only while the animated scene runs. */
export const MOTION_CTL = {
  pause: 'pause motion',
  play: 'play motion',
} as const;

export const LABELS = {
  hero: '01 / backend engineer',
  whatIDo: '02 / what i do',
  experience: '03 / experience',
  projects: '04 / projects',
  stack: '05 / stack',
  queue: '06 / queue',
  studio: '07 / work with me',
  about: '08 / about',
  contact: '09 / contact',
} as const;

export const HERO = {
  words: ['GUILLERMO', 'CAMPOLLO'],
  lede: 'Backend engineer. Python, APIs, queues and data — from startups to big companies.',
  emailLabel: 'email',
  proof: "Python backend engineer · 6+ years · SoFi, Moody's",
  /** Short form of the About work-arrangement line (same facts). */
  visa: 'Remote from Mexico for US teams · contractor or employer-of-record',
  cvLabel: 'cv',
  where: 'Guadalajara, MX · Remote · ',
  open: 'Open to freelance',
} as const;

export const WHAT_I_DO = {
  heading: 'What I do',
  /** Bracket link under the list. */
  more: { label: 'see the work', href: '#projects' },
  /** `lead` is the bold start of the line, `rest` the plain remainder (starts with a space). */
  items: [
    { lead: 'APIs and databases', rest: ' that hold up in production.' },
    { lead: 'RAG pipelines and AI agent integrations', rest: ' that answer from your own data.' },
    {
      lead: 'Data lakes',
      rest: " that put your company's data in one place, ready for reports and AI.",
    },
    { lead: 'UI/UX too', rest: ', when the product needs screens.' },
  ],
} as const;

export interface Company {
  readonly name: string;
  /** Lines of the extruded name, split at the "|" in the concept. */
  readonly lines: readonly string[];
  readonly role: string;
  readonly years: string;
  readonly stack: string;
}

const BIG: readonly Company[] = [
  {
    name: 'SoFi',
    lines: ['SoFi'],
    role: 'Backend engineer, Money Movement',
    years: '2024 – 2026',
    stack: 'FastAPI, AWS, Temporal',
  },
  {
    name: "Moody's",
    lines: ["Moody's"],
    role: 'Architect & lead dev, workflow orchestrator',
    years: '2024 – 2026',
    stack: 'FastAPI, Celery, Redis',
  },
  {
    name: 'Anaplan',
    lines: ['Anaplan'],
    role: 'Sr. backend developer, data workflows',
    years: '2022 – 2023',
    stack: 'Airflow, Kubernetes',
  },
];
const STARTUPS: readonly Company[] = [
  {
    name: 'Docsum',
    lines: ['Docsum'],
    role: 'Full-stack engineer, AI document platform',
    years: '2023 – 2024',
    stack: 'FastAPI, Celery, Next.js',
  },
  {
    name: 'Pronto Housing',
    lines: ['Pronto', 'Housing'],
    role: 'Backend dev → Tech lead',
    years: '2021 – 2022',
    stack: 'Django, AWS Lambda',
  },
  {
    name: 'NarrativeWave',
    lines: ['Narrative', 'Wave'],
    role: 'Backend developer',
    years: '2020 – 2021',
    stack: 'Django REST, AWS',
  },
];

export const EXPERIENCE = {
  heading: 'Experience',
  bigLabel: 'Big companies',
  startupLabel: 'Startups',
  /** Decision 13: the consulting overlap is explained once here; neither firm is named. */
  note: "SoFi, Moody's and Anaplan were consulting engagements; SoFi and Moody's ran at the same time.",
  big: BIG,
  startups: STARTUPS,
} as const;

export interface Project {
  readonly name: string;
  readonly line: Copy;
  /** In-page link target; none of the work is public, so most projects link nowhere. */
  readonly href?: string;
}

export const PROJECTS = {
  heading: 'Selected projects',
  items: [
    {
      name: 'Orchestrator',
      line: "Moody's: a FastAPI, Celery and Redis service that coordinates downstream services, with idempotent scheduling and retries.",
      href: '#queue',
    },
    {
      name: 'Money movement',
      line: 'SoFi: Kubernetes microservices on AWS behind the money-movement platform, on call for production.',
    },
    {
      name: 'Doc search',
      line: 'Docsum: RAG search over the product database, plus DocuSign and Paragon integrations.',
    },
  ] satisfies Project[],
} as const;

export const STACK = {
  heading: 'Tech stack',
  groups: [
    {
      name: 'Languages',
      items: 'Python, SQL, TypeScript, JavaScript',
    },
    {
      name: 'Backend & APIs',
      items: 'FastAPI, Django, Flask, Pydantic, SQLAlchemy, REST',
    },
    {
      name: 'Workflows & async',
      items: 'Temporal, Celery, Redis, Airflow',
    },
    {
      name: 'Cloud & platform',
      items: 'AWS (Lambda, ECS, CloudFormation), Kubernetes, Docker',
    },
    {
      name: 'Data & AI',
      items: 'PostgreSQL, OpenAI API, RAG search, pandas, NumPy',
    },
  ],
} as const;

export const QUEUE = {
  heading: 'Queue',
  intro: 'A worker dies mid-job. The queue redelivers it, and the retry stays safe.',
  note: 'Illustrative simulation, not client code.',
  stillCaption: 'One worker killed mid-job',
  /** The one control. */
  button: 'kill a worker',
  /** Shown before the first run, once the live demo has taken over the still frame. */
  readyLine: 'Ready: three workers, six orders to send. Press kill a worker to run it.',
  runningLine: 'Six orders in flight. Worker w2 dies mid-job.',
  /** Spoken in the aria-live line once the run settles; {} slots are filled from the metrics. */
  outcome:
    '{done} of {total} orders done, {lost} lost, {double} double charges. Worker {worker} died after charging; Redis redelivered the job and the retry was recognised, not charged again.',
} as const;

export const STUDIO = {
  heading: 'Work with me',
  intro: 'Fixed-scope projects for startups. You own the code from day one.',
  offers: [
    {
      name: 'AI ops automation',
      time: '~2 weeks',
      line: 'One manual workflow automated end to end.',
    },
    {
      name: 'AI feature on your data',
      time: '3–4 weeks',
      line: 'Answers from your own documents and database, inside your product.',
    },
    {
      name: 'Backend MVP or API integration',
      time: '4–6 weeks',
      line: 'A production-ready Python backend you can grow.',
    },
  ],
  howHeading: 'How it works',
  steps: [
    'Free 30-min call: your problem, my questions.',
    'Paid scoping: a written plan and a fixed price, credited to the build.',
    'Build with tests you sign off on, then a bug-fix warranty.',
  ],
  or: 'or',
} as const;

export const ABOUT = {
  heading: 'About',
  /** Bracket link under the lines. */
  more: { label: 'contact', href: '#contact' },
  lines: [
    'Backend engineer with 6+ years building Python APIs, workflows and data pipelines.',
    "Startups and big companies like SoFi and Moody's, from Django APIs to money-movement services.",
    'Works with US teams remotely from Mexico, as a contractor or through an employer-of-record. Full overlap with US hours.',
    'Based in Guadalajara. Fluent English, native Spanish. B.Sc. in Financial Engineering from ITESO.',
  ] satisfies Copy[],
} as const;

export const CONTACT = {
  heading: "Let's talk.",
  ask: 'Have a backend problem?',
  emailLabel: 'email me',
  bookLabel: 'book a call',
  linkedinLabel: 'linkedin',
  /** Shown as text next to the email button. */
  emailText: 'hello@ermocodes.com',
  /** Confirmed by the user, 2026-11-07. GitHub stays hidden until he gives the URL. */
  linkedin: 'https://www.linkedin.com/in/ermocodes',
  footLeft: '© 2026 Guillermo Campollo',
  footRight: 'Guadalajara, MX',
  /** The 1-page CV is the main button; the full one sits next to it. */
  cv: { label: 'download cv', href: '/cv/guillermo-campollo-cv.pdf' },
  cvFull: { label: 'full cv', href: '/cv/guillermo-campollo-cv-full.pdf' },
  privacy: 'No cookies. Cookieless analytics by Cloudflare.',
} as const;
