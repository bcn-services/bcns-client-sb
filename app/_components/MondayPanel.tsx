/**
 * MondayPanel.tsx — Monday.com priority tasks. Item D feeds `tasks` from
 * jobs_v1 (kind='task'); until then the panel renders its not-connected state
 * with the same chrome.
 */

import { sortPriorityTasks, taskBadge, type PanelState, type TaskLike } from "@/lib/panels";
import { SERVICE_LINKS } from "@/lib/links";
import { MondayDots } from "./icons";
import { Panel, PanelButton, PanelHead, StateNote, ViewAll } from "./Panel";

export function MondayPanel({ state, tasks, connectHref }: { state: PanelState; tasks: TaskLike[]; connectHref: string }) {
  return (
    <Panel className="panel--column">
      <PanelHead tile={<MondayDots />} title="Monday.com" small />
      <div className="subhead subhead--tight">
        <span className="subhead__title">Priority Tasks</span>
        <ViewAll href={SERVICE_LINKS.monday} external />
      </div>
      <div className="panel__fill">
        {state === "data" ? (
          <div className="task-list">
            {sortPriorityTasks(tasks).map((task, i) => {
              const badge = taskBadge(task);
              return (
                <div className="task-row" key={task.id ?? `${task.title ?? ""}-${i}`}>
                  <span className="task-ring" aria-hidden="true" />
                  <span className="task-row__title">{task.title ?? "Untitled task"}</span>
                  <span className={`badge badge--${badge.tone}`}>{badge.label}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <StateNote state={state} label="Monday.com" connectHref={connectHref} />
        )}
      </div>
      <PanelButton href={SERVICE_LINKS.monday} label="Open Monday.com" external />
    </Panel>
  );
}
