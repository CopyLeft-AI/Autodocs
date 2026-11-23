"use client";

import { useEffect, useState } from 'react';

export interface UserPermissions {
  isAdmin: boolean;
  canEditSettings: boolean;
  isHardcodedAdmin: boolean;
}

/** The signed-in user's rights; null while loading or when they could not be read. */
export function usePermissions(): UserPermissions | null {
  const [permissions, setPermissions] = useState<UserPermissions | null>(null);
  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetch('/api/auth/permissions', { credentials: 'include' });
        if (response.ok) setPermissions((await response.json()) as UserPermissions);
      } catch {
        setPermissions(null);
      }
    };
    void load();
  }, []);
  return permissions;
}
