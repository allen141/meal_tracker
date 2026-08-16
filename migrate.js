const { openDatabase } = require("./db");

async function migrate() {
  const database = openDatabase();
  try {
    const version = await database.initDb();
    console.log(`MacroFlow database is at schema version ${version}`);
  } finally {
    await database.close();
  }
}

if (require.main === module) {
  migrate().catch((error) => {
    console.error("MacroFlow database migration failed", error);
    process.exit(1);
  });
}

module.exports = { migrate };
