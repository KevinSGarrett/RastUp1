// web/app/layout.tsx
import type { ReactNode } from "react";

export const metadata = {
  title: "RastUp",
  description: "RastUp app",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
