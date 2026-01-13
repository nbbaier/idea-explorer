const token = process.env.IDEA_EXPLORER_API_TOKEN;
const jobId = process.argv[2];

Bun.env;

if (!(token && jobId)) {
  console.error("Usage: bun run scripts/idea-status.ts <jobId>");
  process.exit(1);
}

const status = await fetch(
  `${process.env.IDEA_EXPLORER_API_URL}/api/status/${jobId}`,
  {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  }
);

console.log(await status.json());
