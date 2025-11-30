// amplify/data/resource.ts
import { a, defineData, type ClientSchema } from "@aws-amplify/backend";
import { viewer } from "../functions/viewer/resource";

// GraphQL schema for Amplify Data
const schema = a.schema({
  // Identity / roles resolver
  viewer: a
    .query()
    .authorization((allow) => [allow.authenticated()])
    .returns(
      a.customType({
        id: a.id().required(),
        email: a.string(),
        username: a.string(),
        groups: a.string().array().required(),
        isBuyer: a.boolean(),
        isSeller: a.boolean(),
        isStudioOwner: a.boolean(),
        isAdmin: a.boolean(),
        isTrust: a.boolean(),
        isSupport: a.boolean(),
        isFinance: a.boolean(),
      })
    )
    .handler(a.handler.function(viewer)),

  // Per‑user profile data
  Profile: a
    .model({
      id: a.id().required(), // same as viewer.id / Cognito sub
      email: a.string(),
      displayName: a.string(),
      avatarUrl: a.string(),
      city: a.string(),
      country: a.string(),
      bio: a.string(),
    })
    .authorization((allow) => [
      // For now any signed‑in user can read/write profiles.
      // On the client we always use viewer.id so you only touch your own.
      allow.authenticated(),
    ]),

  // Minimal booking model: a booking owned by a single user
  Booking: a
    .model({
      id: a.id().required(),
      customerId: a.id().required(),        // viewer.id (Cognito sub)
      title: a.string().required(),         // e.g. "Studio session"
      startTimeIso: a.string().required(),  // ISO date string for now
      endTimeIso: a.string().required(),    // ISO date string for now
      status: a.string().required(),        // "PENDING" | "CONFIRMED" | ...
      notes: a.string(),
    })
    .authorization((allow) => [
      // Again, keep it simple: any signed‑in user can read/write.
      // The UI only shows bookings where booking.customerId === viewer.id.
      allow.authenticated(),
    ]),
});

export type Schema = ClientSchema<typeof schema>;

export const data = defineData({
  name: "rastup-dev-api",
  schema,
});
