type TelemetryPayload = Record<string, unknown> | undefined;

export function emitTelemetry(eventName: string, payload?: TelemetryPayload) {
  const detail = {
    event: eventName,
    payload,
    timestamp: Date.now()
  };

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('rastup:telemetry', { detail }));
    if (process.env.NODE_ENV !== 'production') {
      // eslint-disable-next-line no-console
      console.debug('[telemetry]', eventName, payload ?? {});
    }
  } else if (process.env.NODE_ENV !== 'production') {
    // eslint-disable-next-line no-console
    console.debug('[telemetry]', eventName, payload ?? {});
  }
}
