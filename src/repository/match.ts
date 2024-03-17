const matches = {};
let matchesCol;

export function init(mongoClient, dbName, colName) {
  matchesCol = mongoClient.db(dbName).collection(colName);
}

export async function getMatch(matchID: string) {
  if (matches[matchID]) {
    return matches[matchID];
  }
  const match = await matchesCol.findOne({ _id: matchID });
  matches[matchID] = match;
  return match;
}

export async function updateMatch(matchID, match) {
  matches[matchID] = undefined;
  await matchesCol.updateOne({ _id: matchID }, { $set: match });
}

export async function replaceMatch(matchID, match) {
  matches[matchID] = undefined;
  await matchesCol.replaceOne({ _id: matchID }, match);
}

export async function createMatch(matchID, match) {
  const { ops } = await matchesCol.insertOne({ _id: matchID, ...match });
  return ops;
}
