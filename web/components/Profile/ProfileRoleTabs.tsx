'use client';

import { useId } from 'react';

interface ProfileRoleTabsProps {
  roles: string[];
  activeRole: string | null;
  onSelectRole: (role: string) => void;
}

export function ProfileRoleTabs({ roles, activeRole, onSelectRole }: ProfileRoleTabsProps) {
  const id = useId();
  if (!roles.length) return null;

  return (
    <div className="profile-role-tabs" role="tablist" aria-label="Available roles">
      {roles.map((role) => {
        const selected = role === activeRole;
        return (
          <button
            key={role}
            id={`${id}-${role}`}
            role="tab"
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            className={`profile-role-tabs__tab${selected ? ' profile-role-tabs__tab--active' : ''}`}
            onClick={() => onSelectRole(role)}
          >
            {role.toLowerCase().replace(/_/g, ' ')}
          </button>
        );
      })}
    </div>
  );
}
