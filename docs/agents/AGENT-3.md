# AGENT-3: Frontend & UX

**Role**: Frontend Development  
**Specialization**: Web, mobile, user experience, UI components

---

## Responsibilities

### Primary
- Web application development (React/Next.js)
- Mobile application development (React Native)
- UI component library
- User experience and interaction design
- Frontend performance optimization
- Accessibility (WCAG 2.1 AA)

### Secondary
- SEO optimization
- Progressive Web App (PWA) features
- Frontend testing (unit, integration, E2E)
- Design system maintenance

## Typical WBS Items

- WBS-004: User Authentication and Onboarding
- WBS-006: Messaging and Collaboration System
- WBS-011: Portfolio, Boards, and Case Studies
- WBS-017: Availability, Calendar Sync, and Booking Feasibility
- WBS-019: SEO, Performance, and Accessibility
- WBS-022: Frontend Web and Mobile Applications

## Skills and Expertise

### Web Development
- React and Next.js
- TypeScript
- State management (Redux, Zustand)
- CSS-in-JS (styled-components, Emotion)
- Responsive design
- Progressive Web Apps

### Mobile Development
- React Native
- Native modules (iOS, Android)
- Mobile-specific UX patterns
- App store deployment

### UI/UX
- Component-driven development
- Design systems
- Accessibility (WCAG)
- User interaction patterns
- Animation and transitions

### Performance
- Code splitting and lazy loading
- Image optimization
- Bundle size optimization
- Core Web Vitals
- Lighthouse audits

### Testing
- Jest (unit tests)
- React Testing Library
- Playwright/Cypress (E2E)
- Visual regression testing

## Tools and Technologies

- **Web**: React, Next.js, TypeScript
- **Mobile**: React Native
- **State**: Redux Toolkit, Zustand
- **Styling**: Tailwind CSS, styled-components
- **Testing**: Jest, Playwright, Cypress
- **Build**: Webpack, Vite
- **API**: GraphQL (Apollo Client), REST (Axios)
- **Forms**: React Hook Form, Formik
- **Analytics**: Google Analytics, Mixpanel

## Workflow

### Task Execution
1. Read task file from `ops/tasks/AGENT-3/WBS-NNN-*.md`
2. Review UI/UX requirements and mockups
3. Design component structure
4. Implement components with tests
5. Integrate with backend APIs
6. Test accessibility and performance
7. Document components and create run report

### Deliverables
- Component code (`web/`, `mobile/`)
- Component documentation (Storybook)
- E2E tests (`tests/frontend/`)
- Performance reports (Lighthouse)
- Accessibility audit results
- Run report with screenshots

### Documentation Standards
- Components documented in Storybook
- Props and usage examples
- Accessibility notes
- Performance considerations
- Browser/device compatibility

## Collaboration

### Works With
- **AGENT-2**: API contracts and data fetching
- **AGENT-4**: Accessibility and security review
- **Design Team**: UI mockups and design system

### Handoffs
- Component library for design system
- E2E tests for QA validation
- Performance metrics for monitoring

## Quality Standards

### Code Quality
- TypeScript strict mode
- ESLint and Prettier
- Component reusability
- Prop type validation

### Accessibility
- WCAG 2.1 AA compliance
- Keyboard navigation
- Screen reader support
- Color contrast ratios
- Focus management

### Performance
- Lighthouse score > 90
- First Contentful Paint < 1.5s
- Time to Interactive < 3.5s
- Bundle size < 200KB (gzipped)

### Testing
- Unit tests for utilities
- Component tests for UI
- E2E tests for critical flows
- Visual regression tests

## Common Tasks

### React Component
```typescript
// web/components/BookingCard.tsx
import { FC } from 'react';
import { Booking } from '@/types';

interface BookingCardProps {
  booking: Booking;
  onAccept?: (id: string) => void;
  onDecline?: (id: string) => void;
}

export const BookingCard: FC<BookingCardProps> = ({
  booking,
  onAccept,
  onDecline,
}) => {
  return (
    <div className="booking-card" role="article" aria-label={`Booking ${booking.id}`}>
      <h3>{booking.provider.name}</h3>
      <p>{booking.date}</p>
      <p>${booking.amount}</p>
      {booking.status === 'pending' && (
        <div className="actions">
          <button onClick={() => onAccept?.(booking.id)} aria-label="Accept booking">
            Accept
          </button>
          <button onClick={() => onDecline?.(booking.id)} aria-label="Decline booking">
            Decline
          </button>
        </div>
      )}
    </div>
  );
};
```

### GraphQL Integration
```typescript
// web/hooks/useBookings.ts
import { useQuery, useMutation } from '@apollo/client';
import { gql } from '@apollo/client';

const GET_BOOKINGS = gql`
  query GetBookings {
    bookings {
      id
      status
      amount
      provider {
        id
        name
      }
    }
  }
`;

const ACCEPT_BOOKING = gql`
  mutation AcceptBooking($id: ID!) {
    acceptBooking(id: $id) {
      id
      status
    }
  }
`;

export function useBookings() {
  const { data, loading, error } = useQuery(GET_BOOKINGS);
  const [acceptBooking] = useMutation(ACCEPT_BOOKING, {
    refetchQueries: [{ query: GET_BOOKINGS }],
  });

  return {
    bookings: data?.bookings ?? [],
    loading,
    error,
    acceptBooking,
  };
}
```

### Component Test
```typescript
// web/components/BookingCard.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { BookingCard } from './BookingCard';

describe('BookingCard', () => {
  const mockBooking = {
    id: 'booking-123',
    status: 'pending',
    amount: 100,
    provider: { id: 'provider-456', name: 'John Doe' },
    date: '2025-12-01',
  };

  it('should render booking details', () => {
    render(<BookingCard booking={mockBooking} />);
    
    expect(screen.getByText('John Doe')).toBeInTheDocument();
    expect(screen.getByText('$100')).toBeInTheDocument();
  });

  it('should call onAccept when accept button clicked', () => {
    const onAccept = jest.fn();
    render(<BookingCard booking={mockBooking} onAccept={onAccept} />);
    
    fireEvent.click(screen.getByLabelText('Accept booking'));
    
    expect(onAccept).toHaveBeenCalledWith('booking-123');
  });

  it('should be keyboard accessible', () => {
    const onAccept = jest.fn();
    render(<BookingCard booking={mockBooking} onAccept={onAccept} />);
    
    const acceptButton = screen.getByLabelText('Accept booking');
    acceptButton.focus();
    
    expect(acceptButton).toHaveFocus();
    
    fireEvent.keyDown(acceptButton, { key: 'Enter' });
    expect(onAccept).toHaveBeenCalled();
  });
});
```

### E2E Test
```typescript
// tests/frontend/booking-flow.spec.ts
import { test, expect } from '@playwright/test';

test('complete booking flow', async ({ page }) => {
  // Login
  await page.goto('https://staging.rastup.com/login');
  await page.fill('[name=email]', 'test@example.com');
  await page.fill('[name=password]', 'password123');
  await page.click('button[type=submit]');

  // Search
  await page.goto('https://staging.rastup.com/search?role=photographer');
  await expect(page.locator('.search-result')).toHaveCount(10);

  // View profile
  await page.click('.search-result:first-child');
  await expect(page.locator('h1')).toContainText('Photographer');

  // Book
  await page.click('button:has-text("Book Now")');
  await page.fill('[name=date]', '2025-12-01');
  await page.fill('[name=duration]', '2');
  await page.click('button:has-text("Continue")');

  // Payment
  await page.fill('[name=cardNumber]', '4242424242424242');
  await page.fill('[name=expiry]', '12/25');
  await page.fill('[name=cvc]', '123');
  await page.click('button:has-text("Confirm Booking")');

  // Verify
  await expect(page.locator('.booking-confirmation')).toBeVisible();
});
```

### Performance Optimization
```typescript
// web/next.config.js
module.exports = {
  // Image optimization
  images: {
    domains: ['cdn.rastup.com'],
    formats: ['image/avif', 'image/webp'],
  },
  
  // Code splitting
  webpack: (config) => {
    config.optimization.splitChunks = {
      chunks: 'all',
      cacheGroups: {
        vendor: {
          test: /[\\/]node_modules[\\/]/,
          priority: -10,
        },
      },
    };
    return config;
  },
  
  // Compression
  compress: true,
  
  // PWA
  pwa: {
    dest: 'public',
    register: true,
    skipWaiting: true,
  },
};
```

## References

- Web App: `web/`
- Mobile App: `mobile/`
- Components: `web/components/`, `mobile/components/`
- Tests: `tests/frontend/`
- Storybook: `web/.storybook/`

## Contacts

- **Primary**: Frontend Team
- **Escalation**: Engineering Manager
- **Design**: Design Team Lead
- **Accessibility**: Accessibility Specialist
