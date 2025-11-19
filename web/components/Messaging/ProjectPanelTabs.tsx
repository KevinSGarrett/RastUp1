import React, { useMemo } from 'react';

import { presentProjectPanelActions } from '../../../tools/frontend/messaging/project_panel_presenter.mjs';
import { formatRelativeTimestamp } from '../../../tools/frontend/messaging/ui_helpers.mjs';

const TAB_LABELS: Record<string, string> = {
  brief: 'Brief',
  moodboard: 'Moodboard',
  shotlist: 'Shot list',
  files: 'Files',
  docs: 'Docs & e-sign',
  expenses: 'Expenses',
  actions: 'Actions'
};

type ProjectPanelActionEntry = {
  card: Record<string, any>;
  presentation: Record<string, any>;
};

interface ProjectPanelActionsListProps {
  entries: ProjectPanelActionEntry[];
  emptyState?: React.ReactNode;
}

const ProjectPanelActionsList: React.FC<ProjectPanelActionsListProps> = ({ entries, emptyState }) => {
  if (!entries.length) {
    return (
      <div className="messaging-project-panel__actions messaging-project-panel__actions--empty">
        {emptyState ?? <p className="messaging-project-panel__empty">No action cards yet.</p>}
      </div>
    );
  }

  return (
    <div className="messaging-project-panel__actions">
      <ul className="messaging-project-panel__actions-list">
        {entries.map(({ card, presentation }, index) => {
          const key =
            typeof card.actionId === 'string' && card.actionId.trim().length
              ? card.actionId
              : `panel-action-${index}`;
          const classes = ['messaging-project-panel__action'];
          if (presentation?.requiresAttention) {
            classes.push('messaging-project-panel__action--pending');
          }
          const metadata = Array.isArray(presentation?.metadata) ? presentation.metadata : [];
          const attachments = Array.isArray(presentation?.attachments) ? presentation.attachments : [];
          const updatedLabel =
            presentation?.lastUpdatedAt ?? card.updatedAt ?? card.createdAt ?? null;
          const relativeUpdated = updatedLabel ? formatRelativeTimestamp(updatedLabel) : '';

          return (
            <li key={key} className={classes.join(' ')}>
              <div className="messaging-project-panel__action-header">
                <div className="messaging-project-panel__action-heading">
                  <span className="messaging-project-panel__action-title">{presentation?.title ?? 'Action card'}</span>
                  <span
                    className={`messaging-project-panel__action-state messaging-project-panel__action-state--${presentation?.stateTone ?? 'neutral'}`}
                  >
                    {presentation?.stateLabel ?? 'Unknown'}
                  </span>
                </div>
                {relativeUpdated ? (
                  <span className="messaging-project-panel__action-updated">Updated {relativeUpdated}</span>
                ) : null}
              </div>
              {presentation?.summary ? (
                <p className="messaging-project-panel__action-summary">{presentation.summary}</p>
              ) : null}
              {presentation?.deadline ? (
                <p className="messaging-project-panel__action-deadline">
                  Due {presentation.deadline}
                </p>
              ) : null}
              {metadata.length ? (
                <dl className="messaging-project-panel__action-metadata">
                  {metadata.map((entry, metaIndex) => (
                    <div
                      key={`${key}-metadata-${metaIndex}`}
                      className="messaging-project-panel__action-metadata-row"
                    >
                      <dt>{entry.label}</dt>
                      <dd>{entry.value}</dd>
                    </div>
                  ))}
                </dl>
              ) : null}
              {attachments.length ? (
                <ul className="messaging-project-panel__action-attachments">
                  {attachments.map((attachment, attachmentIndex) => (
                    <li key={`${key}-attachment-${attachmentIndex}`}>
                      <span className="messaging-project-panel__action-attachment-label">
                        {attachment.label}
                      </span>
                      <span className="messaging-project-panel__action-attachment-value">
                        {attachment.value}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
};

export interface ProjectPanelTabsProps {
  projectPanel?: {
    version?: number;
    tabs?: Record<string, any>;
  } | null;
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
      <ul className="messaging-project-panel__list">
        {value.map((item, index) => (
          <li key={index}>{renderTabContent(item)}</li>
        ))}
      </ul>
    );
  }
  if (typeof value === 'object') {
    return (
      <pre className="messaging-project-panel__json">
        {JSON.stringify(value, null, 2)}
      </pre>
    );
  }
  return <p className="messaging-project-panel__value">Unsupported content</p>;
}

export const ProjectPanelTabs: React.FC<ProjectPanelTabsProps> = ({
  projectPanel,
  emptyState = <p className="messaging-project-panel__empty">Project panel data will appear here once available.</p>,
  actionsEmptyState,
  locale = 'en-US',
  timezone = 'UTC',
  currency = 'USD'
}) => {
  const tabs = projectPanel?.tabs ?? {};
  const tabKeys = Object.keys(tabs);
  const presentedActions = useMemo(
    () => presentProjectPanelActions(tabs.actions, { locale, timezone, currency }),
    [tabs.actions, locale, timezone, currency]
  );
  const pendingActionCount = useMemo(
    () => presentedActions.filter((entry) => entry.presentation?.requiresAttention).length,
    [presentedActions]
  );

  if (tabKeys.length === 0) {
    return <div className="messaging-project-panel messaging-project-panel--empty">{emptyState}</div>;
  }

  return (
    <div className="messaging-project-panel">
      <header className="messaging-project-panel__header">
        <h3>Project panel</h3>
        {typeof projectPanel?.version === 'number' ? (
          <span className="messaging-project-panel__version">Version {projectPanel.version}</span>
        ) : null}
      </header>
      <div className="messaging-project-panel__tabs">
        {tabKeys.map((tabKey) => (
          <section key={tabKey} className="messaging-project-panel__tab">
            <h4>
              {TAB_LABELS[tabKey] ?? tabKey}
              {tabKey === 'actions' && presentedActions.length ? (
                <span className="messaging-project-panel__badge">
                  {pendingActionCount > 0
                    ? `${pendingActionCount} pending`
                    : `${presentedActions.length} total`}
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
