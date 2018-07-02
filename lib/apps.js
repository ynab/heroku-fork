'use strict';

let _   = require('lodash');
let cli = require('heroku-cli-util');

function Apps (heroku) {
  this.heroku = heroku;
}

Apps.prototype = {
  getApp: function* (app) {
    try {
      return yield this.heroku.get(`/apps/${app}`);
    } catch(err) {
      if (err.statusCode === 404) {
        console.error(`Couldn't find app ${cli.color.cyan(app)}.`);
        process.exit(1);
      } else { throw err; }
    }
  },

  lookupOrgFromApp: function* (app) {
    try {
      return yield this.heroku.request({path: `/organizations/${app.owner.id}`});
    } catch (err) {
      if (err.statusCode === 404) {
        return null;
      } else {
        throw err;
      }
    }
  },

  lookupSpaceFromSpaceName: function* (spaceName) {
    try {
      return yield this.heroku.request({path: `/spaces/${spaceName}`});
    } catch (err) {
      if (err.statusCode === 404) {
        return null;
      } else {
        throw err;
      }
    }
  },

  createNewApp: function* (oldApp, newAppName, region, space) {
    process.stdout.write(`Forking ${cli.color.cyan(oldApp.name)}... `);
    const org = yield this.lookupOrgFromApp(oldApp);
    const info = {
      name: newAppName,
      region: (region || oldApp.region.name),
      stack: oldApp.stack.name,
      tier: oldApp.tier
    };
    try {
      if (org) {
        // space is only a valid attribute for organization apps
        if (oldApp.space) {
          info.space = oldApp.space.name;
        }
        info.organization = org.name;
      } 
      // Override whatever space was used before with whatever space was given
      if (space && space != "") {
        info.space = space;
        const spaceInfo = yield this.lookupSpaceFromSpaceName(space);
        // Use whatever organization the target space is in.
        // Otherwise, the API will reject the request
        info.organization = spaceInfo.organization.name;
        // If they specified a space, don't specify a region - 
        // let it default to the region that the space is in.
        info.region = undefined;
      } 
      let app = yield this.heroku.request({
        method: 'POST',
        path: info.organization ? '/organizations/apps' : '/apps',
        body: info
      });
      let message = `done. Forked to ${cli.color.cyan(app.name)}`;
      if (info.organization) {
        message += ` in org ${cli.color.green(org.name)}`;
      }
      if (info.space){
        message += `in space ${cli.color.green(info.space)}`;
      }
      console.log(message);
      return app;
    } catch (err) {
      if (err.statusCode === 422 && err.body.message === 'Name is already taken') {
        console.error(`app ${cli.color.cyan(info.name)} already exists.`);
        process.exit(1);
      } else { throw err; }
    }
  },

  getLastRelease: function* (app) {
    let releases = yield this.heroku.request({
      path: `/apps/${app.name}/releases`,
      headers: { 'Range': 'version ..; order=desc;'}
    });
    let release = _.chain(releases)
    .filter('slug')
    .first()
    .value();
    if (!release) {
      throw new Error(`No slug for app ${cli.color.cyan(app.name)} was found.
Push some code to ${cli.color.cyan(app.name)} before forking it.`);
    }
    return release;
  },

  getLastSlug: function* (app) {
    let release = yield this.getLastRelease(app);
    return yield this.heroku.get(`/apps/${app.name}/slugs/${release.slug.id}`);
  },

  copySlug: function* (oldApp, newApp, slug) {
    if (slug.commit) {
      process.stdout.write(`Deploying ${cli.color.green(slug.commit.substring(0,7))} to ${cli.color.cyan(newApp.name)}... `);
    } else {
      process.stdout.write(`Deploying to ${cli.color.cyan(newApp.name)}... `);
    }
    yield this.heroku.post(`/apps/${newApp.name}/releases`, {body: {
      slug: slug.id,
      description: `Forked from ${oldApp.name}`
    }});
    console.log('done');
  },

  setBuildpacks: function (oldApp, newApp) {
    let heroku = this.heroku;
    return heroku.request({
      headers: {'Range': ''},
      path: `/apps/${oldApp.name}/buildpack-installations`
    }).then(function (buildpacks) {
      if (buildpacks.length === 0) { return; }
      buildpacks = buildpacks.map(function (buildpack) {
        return {buildpack: buildpack.buildpack.url};
      });
      return heroku.request({
        method: 'PUT',
        body: {updates: buildpacks},
        headers: {'Range': ''},
        path: `/apps/${newApp.name}/buildpack-installations`
      });
    });
  }
};

module.exports = Apps;
