import React, { memo, useMemo } from 'react';

import { presentProjectPanelActions } from '../../../tools/frontend/messaging/project_panel_presenter.mjs';
import { formatRelativeTimestamp } from '../../../tools/frontend/messaging/ui_helpers.mjs';

// -------------------------------------------------------------------------------------
// Labels & helpers
// -------------------------------------------------------------------------------------

const TAB_LABELS: Record<string, string> = {
  brief: 'Brief',
  moodboard: 'Moodboard',
  shotlist: 'Shot list',
  files: 'Files',
  docs: 'Docs & e-sign',
  expenses: 'Expenses',
  actions: 'Actions'
} as const;

const KNOWN_TAB_ORDER = [
  'brief',
  'moodboard',
  'shotlist',
  'files',
  'docs',
  'expenses',
  'actions'
] as const;

type ProjectPanelActionEntry = {
  card: Record<string, any>;
  presentation: Record<string, any>;
};

interface ProjectPanelActionsListProps {
  entries: ProjectPanelActionEntry[];
  emptyState?: React.ReactNode;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function slugTone(value: unknown): string {
  // Normalize tone class suffixes, e.g. "Needs Attention" -> "needs-attention"
  if (!isNonEmptyString(value)) return 'neutral';
  return value.toLowerCase().replace(/\s+/g, '-');
}

// -------------------------------------------------------------------------------------
// Actions list
// -------------------------------------------------------------------------------------

const ProjectPanelActionsList: React.FC<ProjectPanelActionsListProps> = memo(function ProjectPanelActionsList({
  entries,
  emptyState
}) {
  if (!entries.length) {
    return (
      <div className="messaging-project-panel__actions messaging-project-panel__actions--empty">
        {emptyState ?? <p className="messaging-project-panel__empty">No action cards yet.</p>}
      </div>
    );
  }

  return (
    <div className="messaging-project-panel__actions">
      <ul className="messaging-project-panel__actions-list" role="list" data-testid="project-panel-actions-list">
        {entries.map(({ card, presentation }, index) => {
          const key =
            typeof card?.actionId === 'string' && card.actionId.trim().length
              ? card.actionId
              : `panel-action-${index}`;

          const classes = ['messaging-project-panel__action'];
          if (presentation?.requiresAttention) {
            classes.push('messaging-project-panel__action--pending');
          }

          const metadata = Array.isArray(presentation?.metadata) ? presentation.metadata : [];
          const attachments = Array.isArray(presentation?.attachments) ? presentation.attachments : [];
          const updatedLabel = presentation?.lastUpdatedAt ?? card?.updatedAt ?? card?.createdAt ?? null;
          const relativeUpdated = updatedLabel ? formatRelativeTimestamp(updatedLabel) : '';

          const stateTone = slugTone(presentation?.stateTone);
          const title = presentation?.title ?? 'Action card';

          return (
            <li key={key} className={classes.join(' ')} role="listitem" data-testid="project-panel-action">
              <div className="messaging-project-panel__action-header">
                <div className="messaging-project-panel__action-heading">
                  {isNonEmptyString(presentation?.href) ? (
                    <a
                      className="messaging-project-panel__action-title"
                      href={presentation.href}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      {title}
                    </a>
                  ) : (
                    <span className="messaging-project-panel__action-title">{title}</span>
                  )}
                  <span
                    className={`messaging-project-panel__action-state messaging-project-panel__action-state--${stateTone}`}
                  >
                    {presentation?.stateLabel ?? 'Unknown'}
                  </span>
                </div>

                {relativeUpdated ? (
                  <span className="messaging-project-panel__action-updated" aria-label={`Updated ${relativeUpdated}`}>
                    Updated {relativeUpdated}
                  </span>
                ) : null}
              </div>

              {presentation?.summary ? (
                <p className="messaging-project-panel__action-summary">{presentation.summary}</p>
              ) : null}

              {presentation?.deadline ? (
                <p className="messaging-project-panel__action-deadline">Due {presentation.deadline}</p>
              ) : null}

              {metadata.length ? (
                <dl className="messaging-project-panel__action-metadata">
                  {metadata.map((entry: any, metaIndex: number) => (
                    <React.Fragment key={`${key}-metadata-${metaIndex}`}>
                      <dt className="messaging-project-panel__action-metadata-label">{entry.label}</dt>
                      <dd className="messaging-project-panel__action-metadata-value">{entry.value}</dd>
                    </React.Fragment>
                  ))}
                </dl>
              ) : null}

              {attachments.length ? (
                <ul className="messaging-project-panel__action-attachments" role="list">
                  {attachments.map((attachment: any, attachmentIndex: number) => {
                    const href = attachment?.href ?? attachment?.url ?? null;
                    const value = attachment?.value ?? href ?? '';
                    return (
                      <li key={`${key}-attachment-${attachmentIndex}`} role="listitem">
                        <span className="messaging-project-panel__action-attachment-label">{attachment?.label}</span>
                        <span className="messaging-project-panel__action-attachment-value">
                          {href ? (
                            <a href={href} target="_blank" rel="noopener noreferrer">
                              {value}
                            </a>
                          ) : (
                            value
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
});

// -------------------------------------------------------------------------------------
// Tabs
// -------------------------------------------------------------------------------------

export interface ProjectPanelTabsProps {
  projectPanel?:
    | {
        version?: number;
        // Kept intentionally permissive to avoid breaking upstream payloads
        tabs?: Record<string, unknown>;
      }
    | null;
  emptyState?: React.ReactNode;
  actionsEmptyState?: React.ReactNode;
  locale?: string;
  timezone?: string;
  currency?: string;
}

function renderTabContent(value: unknown): React.ReactNode {
  if (value === null || value === undefined) {
    return <p className="messaging-project-panel__empty">No data yet.</p>;
  }
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return <p className="messaging-project-panel__value">{String(value)}</p>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) {
      return <p className="messaging-project-panel__empty">No entries.</p>;
    }
    return (
      <ul className="messaging-project-panel__list" role="list">
        {value.map((item, index) => (
          <li key={index} role="listitem">
            {renderTabContent(item)}
          </li>
        ))}
      </ul>
    );
  }
  if (typeof value === 'object') {
    return <pre className="messaging-project-panel__json">{JSON.stringify(value, null, 2)}</pre>;
  }
  return <p className="messaging-project-panel__value">Unsupported content</p>;
}

export const ProjectPanelTabs: React.FC<ProjectPanelTabsProps> = ({
  projectPanel,
  emptyState = (
    <p className="messaging-project-panel__empty">Project panel data will appear here once available.</p>
  ),
  actionsEmptyState,
  locale = 'en-US',
  timezone = 'UTC',
  currency = 'USD'
}) => {
  const tabs = (projectPanel?.tabs ?? {}) as Record<string, unknown>;

  const orderedTabKeys = useMemo(() => {
    const keys = Object.keys(tabs);
    if (keys.length === 0) return [];

    const seen = new Set(keys);
    const knownFirst = KNOWN_TAB_ORDER.filter((k) => seen.has(k));
    const rest = keys.filter((k) => !KNOWN_TAB_ORDER.includes(k as any)).sort((a, b) => a.localeCompare(b));
    return [...knownFirst, ...rest];
  }, [tabs]);

  // Present actions safely; if presenter throws or payload is malformed, degrade gracefully
  const presentedActions = useMemo(() => {
    try {
      // tabs.actions can be undefined or any shape; presenter is expected to handle it or return []
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return presentProjectPanelActions((tabs as any).actions, { locale, timezone, currency }) || [];
    } catch {
      return [];
    }
  }, [tabs, locale, timezone, currency]);

  const pendingActionCount = useMemo(
    () => presentedActions.filter((entry: any) => entry?.presentation?.requiresAttention).length,
    [presentedActions]
  );

  if (orderedTabKeys.length === 0) {
    return <div className="messaging-project-panel messaging-project-panel--empty">{emptyState}</div>;
    }

  return (
    <div className="messaging-project-panel" data-testid="project-panel-root">
      <header className="messaging-project-panel__header">
        <h3>Project panel</h3>
        {typeof projectPanel?.version === 'number' ? (
          <span className="messaging-project-panel__version">Version {projectPanel.version}</span>
        ) : null}
      </header>

      <div className="messaging-project-panel__tabs">
        {orderedTabKeys.map((tabKey) => (
          <section key={tabKey} className="messaging-project-panel__tab" aria-labelledby={`tab-${tabKey}-label`}>
            <h4 id={`tab-${tabKey}-label`}>
              {TAB_LABELS[tabKey] ?? tabKey}
              {tabKey === 'actions' && presentedActions.length ? (
                <span
                  className="messaging-project-panel__badge"
                  aria-live="polite"
                  aria-atomic="true"
                  data-testid="project-panel-actions-badge"
                >
                  {pendingActionCount > 0 ? `${pendingActionCount} pending` : `${presentedActions.length} total`}
                </span>
              ) : null}
            </h4>

            <div className="messaging-project-panel__content">
              {tabKey === 'actions' ? (
                <ProjectPanelActionsList entries={presentedActions} emptyState={actionsEmptyState} />
              ) : (
                renderTabContent(tabs[tabKey])
              )}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
};
