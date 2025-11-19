import React from 'react';

const TAB_LABELS: Record<string, string> = {
  brief: 'Brief',
  moodboard: 'Moodboard',
  shotlist: 'Shot list',
  files: 'Files',
  docs: 'Docs & e-sign',
  expenses: 'Expenses',
  actions: 'Actions'
};

export interface ProjectPanelTabsProps {
  projectPanel?: {
    version?: number;
    tabs?: Record<string, any>;
  } | null;
  emptyState?: React.ReactNode;
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
  emptyState = <p className="messaging-project-panel__empty">Project panel data will appear here once available.</p>
}) => {
  const tabs = projectPanel?.tabs ?? {};
  const tabKeys = Object.keys(tabs);

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
            <h4>{TAB_LABELS[tabKey] ?? tabKey}</h4>
            <div className="messaging-project-panel__content">{renderTabContent(tabs[tabKey])}</div>
          </section>
        ))}
      </div>
    </div>
  );
};
