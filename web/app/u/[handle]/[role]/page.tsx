import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { ProfilePage } from '../../../../components/Profile';
import { createProfileDataSource } from '../../../../lib/profiles';

type ProfilePageParams = {
  params: {
    handle: string;
    role: string;
  };
};

function toRoleParam(value: string) {
  return value?.toUpperCase().replace(/-/g, '_');
}

export async function generateMetadata({ params }: ProfilePageParams): Promise<Metadata> {
  const dataSource = createProfileDataSource();
  const role = toRoleParam(params.role);
  const payload = await dataSource.fetchProfile({
    handle: params.handle,
    role,
    safeMode: true
  });

  if (!payload.profile) {
    return {
      title: 'Profile not found | RastUp'
    };
  }

  const title = `${payload.profile.displayName} — ${role ?? 'Talent'} | RastUp`;
  const description =
    payload.seo?.metaDescription ??
    (payload.profile.bio ? payload.profile.bio.slice(0, 160) : `View ${payload.profile.displayName} on RastUp.`);
  const canonical = `https://rastup.com/u/${params.handle}/${params.role}`;

  return {
    title,
    description,
    alternates: {
      canonical
    },
    openGraph: {
      title,
      description,
      url: canonical,
      type: 'profile',
      images: payload.hero?.url ? [{ url: payload.hero.url, alt: payload.hero.alt ?? title }] : undefined
    }
  };
}

export default async function ProfileRoute({ params }: ProfilePageParams) {
  const dataSource = createProfileDataSource();
  const role = toRoleParam(params.role);
  const payload = await dataSource.fetchProfile({
    handle: params.handle,
    role,
    safeMode: true
  });

  if (!payload.profile) {
    notFound();
  }

  const normalized = payload;
  const jsonLdDocuments = normalized.seo?.jsonLd ?? [];

  return (
    <>
      <ProfilePage initialProfile={normalized} handle={params.handle} initialSafeMode />
      {jsonLdDocuments.map(
  (doc: Record<string, unknown>, index: number) => (
    <script
      key={index}
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(doc) }}
    />
  )
)}
    </>
  );
}
