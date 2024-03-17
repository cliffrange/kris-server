import { Player } from "cricket-scorer-store";
const shortid = require("shortid");

let playersCol;

export function init(mongoClient, dbName, colName) {
  playersCol = mongoClient.db(dbName).collection(colName);
}

export async function createPlayers(players: Player[]) {
  const result = await playersCol.insertMany(
    players.map(({ firstName, lastName, role }) => ({
      _id: shortid.generate(),
      firstName,
      lastName,
      role,
    })),
  );
  const playerIDs = result.ops.map((op) => op._id);
  return playerIDs;
}
