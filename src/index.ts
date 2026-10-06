import { readConfig, setUser } from "./config.js";
import {
  createUser,
  deleteAllUsers,
  getUser,
  getUsers,
} from "./lib/db/queries/users";
import { fetchFeed } from "./rss";
import { createFeed } from "./lib/db/queries/feeds";
import { users } from "./lib/db/schema";
import { feeds } from "./lib/db/schema";
import {
  createFeed,
  createFeedFollow,
  deleteFeedFollow,
  getFeedByURL,
  getFeedFollowsForUser,
  getFeeds,
} from "./lib/db/queries/feeds";

type Feed = typeof feeds.$inferSelect;
type User = typeof users.$inferSelect;

type CommandHandler = (cmdName: string, ...args: string[]) => Promise<void>;

function printFeed(feed: Feed, user: User): void {
  console.log(`Feed: ${feed.name}`);
  console.log(`URL: ${feed.url}`);
  console.log(`User: ${user.name}`);
}

async function handlerFollow(
  cmdName: string,
  user: User,
  ...args: string[]
): Promise<void> {
  if (args.length < 1) {
    throw new Error("follow command requires a url");
  }

  const url = args[0];

  const feed = await getFeedByURL(url);

  if (!feed) {
    throw new Error(`Feed with URL ${url} does not exist`);
  }

  const feedFollow = await createFeedFollow(feed.id, user.id);

  console.log(`* ${feedFollow.feedName}`);
  console.log(`* ${feedFollow.userName}`);
}

async function handlerUnfollow(
  cmdName: string,
  user: User,
  ...args: string[]
): Promise<void> {
  if (args.length < 1) {
    throw new Error("unfollow command requires a url");
  }

  const url = args[0];

  await deleteFeedFollow(user.id, url);
}

async function handlerFollowing(
  cmdName: string,
  user: User,
  ...args: string[]
): Promise<void> {
  const feedFollows = await getFeedFollowsForUser(user.id);

  for (const feedFollow of feedFollows) {
    console.log(`* ${feedFollow.feedName}`);
  }
}

async function handlerFeeds(cmdName: string, ...args: string[]): Promise<void> {
  const feeds = await getFeeds();

  for (const { feed, user } of feeds) {
    console.log(`* ${feed.name}`);
    console.log(`  URL: ${feed.url}`);
    console.log(`  User: ${user.name}`);
  }
}

async function handlerAddFeed(
  cmdName: string,
  user: User,
  ...args: string[]
): Promise<void> {
  if (args.length < 2) {
    throw new Error("addfeed command requires a name and url");
  }

  const name = args[0];
  const url = args[1];

  const feed = await createFeed(name, url, user.id);
  const feedFollow = await createFeedFollow(feed.id, user.id);

  console.log(`Feed: ${feedFollow.feedName}`);
  console.log(`User: ${feedFollow.userName}`);

  printFeed(feed, user);
}

async function handlerAgg(cmdName: string, ...args: string[]): Promise<void> {
  const feed = await fetchFeed("https://www.wagslane.dev/index.xml");

  console.dir(feed, { depth: null });
}

async function handlerUsers(cmdName: string, ...args: string[]): Promise<void> {
  const users = await getUsers();
  const currentUser = readConfig().currentUserName;

  for (const user of users) {
    if (user.name === currentUser) {
      console.log(`* ${user.name} (current)`);
    } else {
      console.log(`* ${user.name}`);
    }
  }
}

async function handlerReset(cmdName: string, ...args: string[]): Promise<void> {
  await deleteAllUsers();

  console.log("Database reset successfully");
}

type CommandHandler = (cmdName: string, ...args: string[]) => Promise<void>;

type CommandsRegistry = Record<string, CommandHandler>;

type User = typeof users.$inferSelect;

type UserCommandHandler = (
  cmdName: string,
  user: User,
  ...args: string[]
) => Promise<void>;

function middlewareLoggedIn(handler: UserCommandHandler): CommandHandler {
  return async (cmdName: string, ...args: string[]): Promise<void> => {
    const userName = readConfig().currentUserName;

    const user = await getUser(userName);

    if (!user) {
      throw new Error(`User ${userName} not found`);
    }

    await handler(cmdName, user, ...args);
  };
}

async function handlerLogin(cmdName: string, ...args: string[]): Promise<void> {
  if (args.length === 0) {
    throw new Error("login command requires a username");
  }

  const username = args[0];
  const user = await getUser(username);

  if (!user) {
    throw new Error(`User ${username} does not exist`);
  }

  setUser(username);

  console.log(`Logged in as ${username}`);
}

async function handlerRegister(
  cmdName: string,
  ...args: string[]
): Promise<void> {
  if (args.length === 0) {
    throw new Error("register command requires a username");
  }

  const username = args[0];

  const existingUser = await getUser(username);

  if (existingUser) {
    throw new Error(`User ${username} already exists`);
  }

  const user = await createUser(username);

  setUser(username);

  console.log(`User ${username} was created`);
  console.log(user);
}

function registerCommand(
  registry: CommandsRegistry,
  cmdName: string,
  handler: CommandHandler,
): void {
  registry[cmdName] = handler;
}

async function runCommand(
  registry: CommandsRegistry,
  cmdName: string,
  ...args: string[]
): Promise<void> {
  const handler = registry[cmdName];

  if (!handler) {
    throw new Error(`Unknown command: ${cmdName}`);
  }

  await handler(cmdName, ...args);
}

async function main(): Promise<void> {
  const registry: CommandsRegistry = {};

  registerCommand(registry, "login", handlerLogin);
  registerCommand(registry, "register", handlerRegister);
  registerCommand(registry, "reset", handlerReset);
  registerCommand(registry, "users", handlerUsers);
  registerCommand(registry, "agg", handlerAgg);
  registerCommand(registry, "feeds", handlerFeeds);
  registerCommand(registry, "addfeed", middlewareLoggedIn(handlerAddFeed));

  registerCommand(registry, "follow", middlewareLoggedIn(handlerFollow));

  registerCommand(
  registry,
  "unfollow",
  middlewareLoggedIn(handlerUnfollow),
);

  registerCommand(registry, "following", middlewareLoggedIn(handlerFollowing));

  const args = process.argv.slice(2);

  if (args.length === 0) {
    console.error("Error: not enough arguments");
    process.exit(1);
  }

  const cmdName = args[0];
  const cmdArgs = args.slice(1);

  try {
    await runCommand(registry, cmdName, ...cmdArgs);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }

  process.exit(0);
}

main();
