const _ = require("lodash");
const utils = require("./lib/utils");
const MigrationsHandler = require("./handlers/migrationsHandler");
const SequelizeCliHandler = require("./handlers/sequelizeCliHandler");
const secretsManager = require('./lib/secretsmanager')

class SequelizeMigrations {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;
    this.aws = this.serverless.getProvider('aws');

    this.commands = {
      migrations: {
        usage: "Sequelize migrations management for Serverless",
        lifecycleEvents: ["showPluginInfo"],
        options: {
          path: {
            usage: "Specify the migrations path (default is './migrations')",
            shortcut: "p",
            default: "./migrations"
          },
          verbose: {
            usage: "Shows sequelize logs",
            shortcut: "v"
          }
        },
        commands: {
          create: {
            usage: "Create a migration file",
            lifecycleEvents: ["run"],
            options: {
              name: {
                usage: "Specify the name of the migration to be created",
                shortcut: "n",
                required: true
              }
            }
          },
          up: {
            usage: "Execute all pending migrations",
            lifecycleEvents: ["run"],
            options: {
              rollback: {
                usage:
                  "Rolls back applied migrations in case of error (default is false)",
                shortcut: "r",
                default: false
              }
            }
          },
          down: {
            usage: "Rolls back one or more migrations",
            lifecycleEvents: ["run"],
            options: {
              times: {
                usage: "Specify how many times to roll back (default is 1)",
                shortcut: "t",
                default: 1
              },
              name: {
                usage:
                  'Specify the name of the migration to be rolled back (e.g. "--name create-users.js")',
                shortcut: "n"
              }
            }
          },
          reset: {
            usage: "Rolls back all migrations",
            lifecycleEvents: ["run"]
          },
          list: {
            usage: "Shows a list of migrations",
            lifecycleEvents: ["show"],
            options: {
              status: {
                usage:
                  "Specify the status of migrations to be listed (--status pending [default] or --status executed)",
                shortcut: "s",
                default: "pending"
              }
            }
          }
        }
      }
    };

    this.hooks = {
      "migrations:showPluginInfo": this.showPluginInfo.bind(this),
      "migrations:up:run": this.migrate.bind(this),
      "migrations:down:run": this.revert.bind(this),
      "migrations:reset:run": this.reset.bind(this),
      "migrations:list:show": this.list.bind(this),
      "migrations:create:run": this.createMigration.bind(this),
      "before:aws:deploy:deploy:updateStack": () => this.serverless.pluginManager.run(['migrations', 'up']),
    };

    this.verbose = this.options.verbose || this.options.v;
    this.path =
      this.options.path ||
      this.options.p ||
      _.get(this.serverless, "service.custom.migrationsPath");
  }

  showPluginInfo() {
    this.serverless.cli.generateCommandsHelp(["migrations"]);
  }

  async setUpDatabaseValues(secretId, dbName) {
    const dbSecret = await secretsManager.getSecret(this.aws, secretId)

    let error = false;
    if (!dbSecret.engine) {
      error = "DB_DIALECT";
    } else if (!dbSecret.host) {
      error = "DB_HOST";
    } else if (!dbSecret.port) {
      error = "DB_PORT";
    } else if (!dbName) {
      error = "DB_NAME";
    } else if (!dbSecret.username) {
      error = "DB_USERNAME";
    } else if (!dbSecret.password) {
      error = "DB_PASSWORD";
    }

    if (error) {
      this.serverless.cli.log(`Missing ${error} in the environment variables`);
      process.exit(1);
    }

    return {
      DIALECT: dbSecret.engine,
      HOST: dbSecret.host,
      PORT: dbSecret.port,
      NAME: dbName,
      USERNAME: dbSecret.username,
      PASSWORD: dbSecret.password
    };
  }

  async setUpMigrationsHandler(stage) {
    let secretId = this.serverless.service.custom.sequelize[stage].secretId
    let dbName = this.serverless.service.custom.sequelize[stage].dbName

    let error = false;
    if(!secretId) {
      error = "secretId";
    } else if(!dbName) {
      error = "dbName";
    }
    if(error) {
      this.serverless.cli.log(`Missing ${error} for stage: ${stage}`);
      process.exit(1);
    } else {
      const database = await this.setUpDatabaseValues(secretId, dbName);

      const migrationsHandler = new MigrationsHandler(
        this.serverless,
        database,
        this.path,
        this.verbose
      );

      migrationsHandler.initialize();

      return migrationsHandler;
    }
  }

  async migrate() {
    let stage = utils.getStage(this.serverless, this.options);
    if(this.serverless.service.custom.sequelize && this.serverless.service.custom.sequelize[stage]) {
      try {
        const migrationsHandler = await this.setUpMigrationsHandler(stage);
  
        const success = await migrationsHandler.migrate(this.options.rollback);
        if (!success) process.exit(1);
      } catch (e) {
        this.serverless.cli.log(`Error trying to apply migrations: \n${e}`);
        process.exit(1);
      }
    } else {
      this.serverless.cli.log(`Database credentials not configured for stage: ${stage}`);
    }
  }

  async revert() {
    let stage = utils.getStage(this.serverless, this.options);
    if(this.serverless.service.custom.sequelize && this.serverless.service.custom.sequelize[stage]) {
      try {
        const migrationsHandler = await this.setUpMigrationsHandler(stage);
  
        await migrationsHandler.revert(this.options.times, this.options.name);
      } catch (e) {
        this.serverless.cli.log(`Error trying to rollback migrations: \n${e}`);
        process.exit(1);
      }
    } else {
      this.serverless.cli.log(`Database credentials not configured for stage: ${stage}`);
    }
  }

  async reset() {
    let stage = utils.getStage(this.serverless, this.options);
    if(this.serverless.service.custom.sequelize && this.serverless.service.custom.sequelize[stage]) {
      try {
        const migrationsHandler = this.setUpMigrationsHandler(stage);
  
        await migrationsHandler.reset();
      } catch (e) {
        this.serverless.cli.log(`Error trying to revert all migrations: \n${e}`);
        process.exit(1);
      }
    } else {
      this.serverless.cli.log(`Database credentials not configured for stage: ${stage}`);
    }
  }

  async list() {  
    let stage = utils.getStage(this.serverless, this.options);
    if(this.serverless.service.custom.sequelize && this.serverless.service.custom.sequelize[stage]) {
      try {
        const migrationsHandler = this.setUpMigrationsHandler(stage);
  
        await migrationsHandler.list(this.options.status);
      } catch (e) {
        this.serverless.cli.log(`Error trying to list migrations: \n${e}`);
        process.exit(1);
      }
    } else {
      this.serverless.cli.log(`Database credentials not configured for stage: ${stage}`);
    }
  }

  setUpSequelizeCliHandler() {
    return new SequelizeCliHandler(this.serverless);
  }

  createMigration() {
    let stage = utils.getStage(this.serverless, this.options);
    if(this.serverless.service.custom.sequelize && this.serverless.service.custom.sequelize[stage]) {
      try {
        const sequelizeCliHandler = this.setUpSequelizeCliHandler();
  
        sequelizeCliHandler.createMigration(this.options.name);
      } catch (e) {
        this.serverless.cli.log(`Error trying to create migration: \n${e}`);
        process.exit(1);
      }
    } else {
      this.serverless.cli.log(`Database credentials not configured for stage: ${stage}`);
    }
  }
}

module.exports = SequelizeMigrations;
