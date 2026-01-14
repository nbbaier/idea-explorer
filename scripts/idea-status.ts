const token = process.env.IDEA_EXPLORER_API_TOKEN;
const jobId = process.argv[2];

console.log(process.argv, jobId);

if (!jobId) {
  console.error("Usage: bun run scripts/idea-status.ts <jobId>");
  process.exit(1);
}

if (!token) {
  console.error("IDEA_EXPLORER_API_TOKEN is not set");
  process.exit(1);
}

console.log(`Checking status for job ${jobId}`);
const url = `${process.env.IDEA_EXPLORER_API_URL}/api/status/${jobId}`;

const status = await fetch(url, {
  headers: {
    Authorization: `Bearer ${token}`,
  },
});

console.log(await status.json());
