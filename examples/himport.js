const Redis = require("..");

// -----------------------------------------------------------------------------
// 1. Managed fieldsets: configure once and use for the client's lifetime
// -----------------------------------------------------------------------------

async function managedFieldsetsExample() {
  const redis = new Redis({
    himportFieldsets: [
      {
        name: "user-profile",
        fields: ["name", "email", "age"],
      },
    ],
  });

  try {
    await redis.himport(
      "SET",
      "himport:managed:user:1",
      "user-profile",
      "Ada",
      "ada@example.com",
      "37"
    );

    console.log("Managed:", await redis.hgetall("himport:managed:user:1"));
  } finally {
    await redis.del("himport:managed:user:1");
    redis.disconnect();
  }
}

// -----------------------------------------------------------------------------
// 2. Manual batches: explicitly prepare, use, and discard a fieldset
// -----------------------------------------------------------------------------

async function manualBatchExample() {
  const redis = new Redis();

  try {
    await redis.himport("PREPARE", "batch-user", "name", "email");

    try {
      await redis.himport(
        "SET",
        "himport:batch:user:1",
        "batch-user",
        "Grace",
        "grace@example.com"
      );

      console.log("Manual:", await redis.hgetall("himport:batch:user:1"));
    } finally {
      await redis.himport("DISCARD", "batch-user");
    }
  } finally {
    await redis.del("himport:batch:user:1");
    redis.disconnect();
  }
}

async function main() {
  await managedFieldsetsExample();
  await manualBatchExample();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
