'use client';

import { ReactNode } from 'react';
import { Amplify } from 'aws-amplify';
import { Authenticator } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';

// The sandbox writes this file for you via `npm run amplify:sandbox`
import outputs from '../amplify_outputs.json';

// Configure Amplify once on the client with the generated outputs
Amplify.configure(outputs);

export function AmplifyProvider({ children }: { children: ReactNode }) {
  return (
    <Authenticator>
      {children}
    </Authenticator>
  );
}
