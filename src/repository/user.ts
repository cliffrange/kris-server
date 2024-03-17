let usersCol;

export function init(mongoClient, dbName, colName) {
  usersCol = mongoClient.db(dbName).collection(colName);
}

export async function addTeam(user: string, newTeam) {
  await usersCol.updateOne({ _id: user }, { $push: { teams: newTeam } });
}

export async function addMatch(user: string, matchSummary) {
  await usersCol.updateOne(
    { _id: user },
    { $set: { [`matches.${matchSummary.id}`]: matchSummary } },
  );
}
