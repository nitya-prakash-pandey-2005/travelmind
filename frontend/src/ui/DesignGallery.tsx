import { Badge } from "./Badge";
import { Button } from "./Button";
import { Panel } from "./Panel";
import { Readout } from "./Readout";
import { StatusDot } from "./StatusDot";
import { TextField } from "./TextField";

const TOKENS = [
  "--tm-void",
  "--tm-deck",
  "--tm-raised",
  "--tm-line",
  "--tm-text",
  "--tm-text-dim",
  "--tm-primary",
  "--tm-ai",
  "--tm-warn",
  "--tm-ok",
  "--tm-danger",
];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-sm uppercase tracking-[0.25em] text-primary">{title}</h2>
      {children}
    </section>
  );
}

/** Living style guide for the Mission Control design language. */
export function DesignGallery() {
  return (
    <div className="flex flex-col gap-8">
      <header>
        <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-dim">Design system</p>
        <h1 className="font-display text-2xl text-ink">Mission Control</h1>
      </header>

      <Section title="Colour tokens">
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {TOKENS.map((token) => (
            <li key={token} className="flex flex-col gap-1">
              <span className="h-12 rounded-sm border border-line" style={{ background: `var(${token})` }} />
              <code className="font-mono text-xs text-dim">{token}</code>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Typography">
        <p className="font-display text-3xl tracking-[0.2em] text-ink">CHAKRA PETCH · DISPLAY</p>
        <p className="font-sans text-base text-ink">IBM Plex Sans carries body copy and long-form text.</p>
        <p className="font-mono text-base text-primary">JETBRAINS MONO · DEL → BOM · INR 4,500 · PNR X7Q2LM</p>
      </Section>

      <Section title="Controls">
        <div className="flex flex-wrap gap-3">
          <Button>Engage</Button>
          <Button variant="ghost">Standby</Button>
          <Button variant="danger">Abort</Button>
          <Button loading>Scanning</Button>
          <Button size="sm">Small</Button>
        </div>
      </Section>

      <Section title="Fields">
        <div className="grid max-w-xl gap-4 sm:grid-cols-2">
          <TextField label="Email" placeholder="you@agency.com" />
          <TextField label="Password" type="password" hint="At least 10 characters" />
          <TextField label="Agency name" defaultValue="!" error="Agency name is too short." />
        </div>
      </Section>

      <Section title="Signals">
        <div className="flex flex-wrap items-center gap-3">
          <Badge>neutral</Badge>
          <Badge tone="primary">live</Badge>
          <Badge tone="ok">verified</Badge>
          <Badge tone="warn">policy</Badge>
          <Badge tone="danger">blocked</Badge>
          <Badge tone="ai">ai</Badge>
          <StatusDot status="ok" label="API online" />
          <StatusDot status="degraded" label="API degraded" />
          <StatusDot status="down" label="API offline" />
        </div>
      </Section>

      <Section title="Readouts">
        <dl className="grid max-w-xl grid-cols-2 gap-4">
          <Readout label="Great-circle distance" value="1,138" unit="km" hint="615 nmi" />
          <Readout label="Est. flight time" value="1h 58m" hint="Estimate" />
        </dl>
      </Section>

      <Section title="Panels">
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel eyebrow="Instrument" title="Default panel">
            <p className="text-sm text-dim">Bracketed corners in the primary accent.</p>
          </Panel>
          <Panel eyebrow="Copilot" title="AI panel" tone="ai">
            <p className="text-sm text-dim">AI activity uses the magenta accent.</p>
          </Panel>
        </div>
      </Section>
    </div>
  );
}
