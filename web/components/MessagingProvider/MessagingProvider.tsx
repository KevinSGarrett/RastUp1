import React, { PropsWithChildren } from 'react';
import { createMessagingReactBindings } from '../../../tools/frontend/messaging/react_bindings.mjs';

const bindings = createMessagingReactBindings({ react: React });

export type MessagingProviderProps = PropsWithChildren<
  Parameters<typeof bindings.MessagingProvider>[0]
>;

export const MessagingProvider: React.FC<MessagingProviderProps> = (props) =>
  bindings.MessagingProvider(props);

export const useMessaging = bindings.useMessaging;
export const useMessagingController = bindings.useMessagingController;
export const useMessagingClient = bindings.useMessagingClient;
export const useMessagingActions = bindings.useMessagingActions;
export const useInboxThreads = bindings.useInboxThreads;
export const useInboxSummary = bindings.useInboxSummary;
export const useThread = bindings.useThread;
export const useUploads = bindings.useUploads;
export const useModerationQueue = bindings.useModerationQueue;
export const useNotifications = bindings.useNotifications;
