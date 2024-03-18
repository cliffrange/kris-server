import { Player } from "@cliffrange/kris-store";
const nanoid = require("nanoid");

let playersCol;

export function init(mongoClient, dbName, colName) {
  playersCol = mongoClient.db(dbName).collection(colName);
}

export async function createPlayers(players: Player[]) {
  const result = await playersCol.insertMany(
    players.map(({ firstName, lastName, role }) => ({
      _id: nanoid(),
      firstName,
      lastName,
      role,
    }))
  );
  const playerIDs = result.ops.map((op) => op._id);
  return playerIDs;
}
