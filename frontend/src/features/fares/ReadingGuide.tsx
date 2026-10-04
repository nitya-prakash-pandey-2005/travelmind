import { BookOpen } from "lucide-react";
import type { ReactNode } from "react";
import { Panel } from "../../ui/Panel";

export type GuideSection = { title: string; entries: { term: ReactNode; text: string }[] };

/** "How to read results": what each label on a result means, in columns, with an optional footnote. */
export function ReadingGuide({ sections, note }: { sections: GuideSection[]; note?: string }) {
  return (
    <Panel title="How to read results" icon={BookOpen} description="What the labels on each result mean">
      <div className="grid gap-x-6 gap-y-5 md:grid-cols-3">
        {sections.map((section) => (
          <section key={section.title} aria-label={section.title} className="flex min-w-0 flex-col gap-2.5">
            <h3 className="hud">{section.title}</h3>
            <dl className="flex flex-col gap-2.5">
              {section.entries.map((entry, index) => (
                <div key={index} className="flex min-w-0 flex-col items-start gap-1">
                  <dt>{entry.term}</dt>
                  <dd className="text-xs leading-4 text-dim">{entry.text}</dd>
                </div>
              ))}
            </dl>
          </section>
        ))}
      </div>
      {note && <p className="mt-4 border-t border-line pt-3 text-xs leading-4 text-faint">{note}</p>}
    </Panel>
  );
}
