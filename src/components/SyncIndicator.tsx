/**
 * CertVoice — SyncIndicator Component
 *
 * Small UI badge showing the current sync status.
 * Placed in the inspection capture header.
 *
 * States:
 *   synced  — green dot, "Saved"
 *   syncing — animated spinner, "Syncing..."
 *   offline — amber dot, "Offline" (data safe locally)
 *   error   — red dot, "Sync error" (tap to retry)
 *   idle    — grey dot (waiting)
 *
 * @module components/SyncIndicator
 */

import { useState, useEffect, useCallback } from 'react'
import { Cloud, CloudOff, RefreshCw, Check, AlertCircle } from 'lucide-react'
import type { SyncServiceState, SyncStatus } from '../services/syncService'

// ============================================================
// TYPES
// ============================================================

interface SyncIndicatorProps {
  /** Subscribe function from sync service */
  onStatusChange: (callback: (state: SyncServiceState) => void) => () => void
  /** Trigger manual sync */
  onSyncNow: () => void
}

// ============================================================
// STATUS CONFIG
// ============================================================

const STATUS_CONFIG: Record<SyncStatus, {
  icon: typeof Cloud
  label: string
  className: string
  animate?: boolean
}> = {
  synced: {
    icon: Check,
    label: 'Saved',
    className: 'text-certvoice-green bg-certvoice-green/10 border-certvoice-green/30',
  },
  syncing: {
    icon: RefreshCw,
    label: 'Syncing...',
    className: 'text-certvoice-accent bg-certvoice-accent/10 border-certvoice-accent/30',
    animate: true,
  },
  offline: {
    icon: CloudOff,
    label: 'Offline',
    className: 'text-certvoice-amber bg-certvoice-amber/10 border-certvoice-amber/30',
  },
  error: {
    icon: AlertCircle,
    label: 'Sync error',
    className: 'text-certvoice-red bg-certvoice-red/10 border-certvoice-red/30',
  },
  idle: {
    icon: Cloud,
    label: '',
    className: 'text-certvoice-muted bg-certvoice-surface-2 border-certvoice-border',
  },
}

// ============================================================
// COMPONENT
// ============================================================

export default function SyncIndicator({ onStatusChange, onSyncNow }: SyncIndicatorProps) {
  const [syncState, setSyncState] = useState<SyncServiceState>({
    status: 'idle',
    pendingCount: 0,
    lastSyncedAt: null,
    lastError: null,
  })

  useEffect(() => {
    const unsubscribe = onStatusChange(setSyncState)
    return unsubscribe
  }, [onStatusChange])

  const handleTap = useCallback(() => {
    if (syncState.status === 'error' || syncState.status === 'offline') {
      onSyncNow()
    }
  }, [syncState.status, onSyncNow])

  const config = STATUS_CONFIG[syncState.status]
  const StatusIcon = config.icon

  // Don't show anything if idle with nothing pending
  if (syncState.status === 'idle' && syncState.pendingCount === 0) {
    return null
  }

  return (
    <button
      type="button"
      onClick={handleTap}
      className={`inline-flex items-center gap-1 px-2 py-1 rounded-md border text-[10px] font-semibold transition-colors ${config.className}`}
      title={syncState.lastError ?? config.label}
    >
      <StatusIcon
        className={`w-3 h-3 ${config.animate ? 'animate-spin' : ''}`}
      />
      <span>{config.label}</span>
      {syncState.pendingCount > 0 && syncState.status !== 'synced' && (
        <span className="opacity-70">({syncState.pendingCount})</span>
      )}
    </button>
  )
}
