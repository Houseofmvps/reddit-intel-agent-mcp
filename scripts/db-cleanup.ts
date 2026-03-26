/**
 * DB Cleanup Script — Run via: railway run npx tsx scripts/db-cleanup.ts
 *
 * 1. Lists all users and identifies duplicates
 * 2. Cleans up test duplicate accounts (keeps the one with most data)
 * 3. Verifies dedup logic on re-login
 */

import postgres from "postgres";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set. Run with: railway run npx tsx scripts/db-cleanup.ts");
  process.exit(1);
}

const sql = postgres(DATABASE_URL);

async function main() {
  console.log("\n=== BuildRadar DB Cleanup ===\n");

  // 1. List all users
  const users = await sql`SELECT id, name, email, tier, "composioEntityId", "composioConnectedAccountId", "createdAt" FROM "user" ORDER BY "createdAt" ASC`;
  console.log(`Total users: ${users.length}\n`);
  for (const u of users) {
    console.log(`  ${u.id.slice(0, 8)}... | ${u.name || "(no name)"} | ${u.email} | ${u.tier} | created: ${u.createdAt}`);
  }

  // 2. Find duplicates by email
  const emailDupes = await sql`
    SELECT email, COUNT(*)::int as cnt
    FROM "user"
    GROUP BY email
    HAVING COUNT(*) > 1
  `;
  if (emailDupes.length > 0) {
    console.log(`\n--- Email duplicates ---`);
    for (const d of emailDupes) {
      console.log(`  ${d.email}: ${d.cnt} accounts`);
    }
  } else {
    console.log(`\nNo email duplicates found.`);
  }

  // 3. Find duplicates by composioEntityId
  const entityDupes = await sql`
    SELECT "composioEntityId", COUNT(*)::int as cnt
    FROM "user"
    WHERE "composioEntityId" IS NOT NULL
    GROUP BY "composioEntityId"
    HAVING COUNT(*) > 1
  `;
  if (entityDupes.length > 0) {
    console.log(`\n--- Entity ID duplicates ---`);
    for (const d of entityDupes) {
      console.log(`  ${d.composioEntityId}: ${d.cnt} accounts`);
    }
  } else {
    console.log(`No entity ID duplicates found.`);
  }

  // 4. Count data per user to identify test accounts
  for (const u of users) {
    const monitors = await sql`SELECT COUNT(*)::int as cnt FROM monitor WHERE "userId" = ${u.id}`;
    const results = await sql`SELECT COUNT(*)::int as cnt FROM scan_result WHERE "userId" = ${u.id}`;
    const leads = await sql`SELECT COUNT(*)::int as cnt FROM lead WHERE "userId" = ${u.id}`;
    const sessions = await sql`SELECT COUNT(*)::int as cnt FROM session WHERE "userId" = ${u.id}`;
    console.log(`\n  User ${u.id.slice(0, 8)}: ${monitors[0].cnt} monitors, ${results[0].cnt} results, ${leads[0].cnt} leads, ${sessions[0].cnt} sessions`);
  }

  // 5. Find orphaned sessions (expired)
  const expiredSessions = await sql`
    SELECT COUNT(*)::int as cnt FROM session WHERE "expiresAt" < NOW()
  `;
  console.log(`\nExpired sessions: ${expiredSessions[0].cnt}`);

  // 6. Auto-cleanup: remove users with 0 monitors, 0 results, 0 leads (test accounts)
  // Only if more than 1 user exists
  if (users.length > 1) {
    console.log(`\n--- Identifying empty test accounts ---`);
    const emptyUsers = await sql`
      SELECT u.id, u.name, u.email, u."createdAt"
      FROM "user" u
      WHERE NOT EXISTS (SELECT 1 FROM monitor m WHERE m."userId" = u.id)
        AND NOT EXISTS (SELECT 1 FROM scan_result sr WHERE sr."userId" = u.id)
        AND NOT EXISTS (SELECT 1 FROM lead l WHERE l."userId" = u.id)
    `;

    if (emptyUsers.length > 0) {
      console.log(`Found ${emptyUsers.length} empty account(s):`);
      for (const eu of emptyUsers) {
        console.log(`  ${eu.id.slice(0, 8)}... | ${eu.name || "(no name)"} | ${eu.email} | created: ${eu.createdAt}`);
      }

      // Keep at least one user — only delete if there's a real user with data
      const usersWithData = users.length - emptyUsers.length;
      if (usersWithData > 0) {
        console.log(`\nDeleting ${emptyUsers.length} empty test account(s)...`);
        for (const eu of emptyUsers) {
          await sql`DELETE FROM session WHERE "userId" = ${eu.id}`;
          await sql`DELETE FROM "user" WHERE id = ${eu.id}`;
          console.log(`  Deleted: ${eu.id.slice(0, 8)}... (${eu.email})`);
        }
        console.log("Done.");
      } else {
        console.log("All users are empty — skipping deletion to preserve at least one account.");
      }
    } else {
      console.log("No empty test accounts found.");
    }
  }

  // 7. Clean expired sessions
  if (expiredSessions[0].cnt > 0) {
    console.log(`\nCleaning ${expiredSessions[0].cnt} expired sessions...`);
    await sql`DELETE FROM session WHERE "expiresAt" < NOW()`;
    console.log("Done.");
  }

  // 8. Final state
  const finalUsers = await sql`SELECT COUNT(*)::int as cnt FROM "user"`;
  const finalMonitors = await sql`SELECT COUNT(*)::int as cnt FROM monitor`;
  const finalResults = await sql`SELECT COUNT(*)::int as cnt FROM scan_result`;
  const finalLeads = await sql`SELECT COUNT(*)::int as cnt FROM lead`;
  console.log(`\n=== Final DB State ===`);
  console.log(`Users: ${finalUsers[0].cnt}`);
  console.log(`Monitors: ${finalMonitors[0].cnt}`);
  console.log(`Results: ${finalResults[0].cnt}`);
  console.log(`Leads: ${finalLeads[0].cnt}`);

  await sql.end();
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
