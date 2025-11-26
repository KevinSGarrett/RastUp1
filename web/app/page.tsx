// web/app/page.tsx
import Link from 'next/link';

export default function HomePage() {
  return (
    <main className="home">
      <h1>RastUp</h1>
      <p>Discovery and bookings for talent and studios.</p>

      <nav>
        <ul>
          <li><Link href="/search">Search talent & studios</Link></li>
          <li><Link href="/u/avery-harper/model">View example profile</Link></li>
          <li><Link href="/booking/srv_mdl_avery">Start example booking</Link></li>
        </ul>
      </nav>
    </main>
  );
}
