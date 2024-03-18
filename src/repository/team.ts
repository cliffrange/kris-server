import { SavedTeam } from "@cliffrange/kris-store";
import { addTeam } from "./user";

let teamsCol;

export function init(mongoClient, dbName, colName) {
  teamsCol = mongoClient.db(dbName).collection(colName);
}

export async function createTeam(
  matchID: string,
  match: SavedTeam,
  user: string
) {
  const { ops } = await teamsCol.insertOne({ _id: matchID, ...match });
  const newTeam = {
    teamName: ops[0].teamName,
    teamID: ops[0]._id,
  };
  await addTeam(user, newTeam);
  return newTeam;
}
