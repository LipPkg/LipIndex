'use strict'

import{consola} from 'consola';
import * as express from 'express';
import httpErrors from 'http-errors';
import {isValidVersionString} from '../lib/version.js';
import {createToothMetadataFromJsonString} from '../lib/tooth_metadata.js';
import acceptLanguageParser from 'accept-language-parser';


/**
 * The regular expression for matching the tooth path.
 * @type {RegExp}
 * @const
 */
const TOOTH_PATH_REGEXP =
    /^github.com\/(?<owner>[a-zA-Z0-9-]+)\/(?<repo>[a-zA-Z0-9-_.]+)$/;

export const router = express.Router();

router.get('/:tooth/:version', async (req, res) => {
  try {
    // No need to check if tooth and version is undefined because
    // express will return 404 if the route doesn't match.

    // Get parameters.
    const toothPathMatch = TOOTH_PATH_REGEXP.exec(req.params.tooth);
    if (toothPathMatch === null) {
      throw new httpErrors.BadRequest('Invalid parameter - tooth.');
    }

    const ownerParam = toothPathMatch.groups.owner;
    const repoParam = toothPathMatch.groups.repo;

    const versionParam = req.params.version;
    if (!isValidVersionString(versionParam)) {
      throw new httpErrors.BadRequest('Invalid parameter - version.');
    }

    // Get client accepted languages.
    const acceptedLanguages =
        [...new Set(acceptLanguageParser.parse(req.headers['accept-language'])
                        .map((language) => {
                          return language.code;
                        }))];

    const [toothMetadata, readme, versionList] = await Promise.all([
      fetchToothMetadata(ownerParam, repoParam, versionParam),
      fetchReadme(ownerParam, repoParam, versionParam, acceptedLanguages),
      fetchVersionList(ownerParam, repoParam),
    ]);

    // Construct the response.
    res.send({
      code: 200,
      data: {
        tooth: toothMetadata.getToothPath(),
        version: toothMetadata.getVersion().toString(),
        name: toothMetadata.getName(),
        description: toothMetadata.getDescription(),
        author: toothMetadata.getAuthor(),
        available_versions: versionList,
        readme: readme,
        tags: toothMetadata.getTags(),
        dependencies: toothMetadata.getDependencies(),
      }
    });

  } catch (error) {
    if (httpErrors.isHttpError(error)) {
      res.status(error.statusCode).send({
        code: error.statusCode,
        message: error.message,
      });
      return;

    } else {
      consola.error(error);
      res.status(500).send({
        code: 500,
        message: 'Internal server error.',
      });
      return;
    }
  }
});

/**
 * Fetches the README.md file from the given owner and repo.
 * @param {string} owner The owner of the tooth.
 * @param {string} repo The name of the tooth.
 * @param {string} versionString The version string.
 * @param {Array<string>} langList The list of 2-char code of accepted
 *     languages.
 * @return {Promise<string|null>} The content of the README.md file.
 */
async function fetchReadme(owner, repo, versionString, langList) {
  const promiseList = [];

  for (const lang of langList) {
    promiseList.push(fetchReadmeForLang(owner, repo, versionString, lang));
  }

  promiseList.push(fetchReadmeForLang(owner, repo, versionString, undefined));

  const readmeList = await Promise.all(promiseList);

  for (const readme of readmeList) {
    if (readme !== null) {
      return readme;
    }
  }

  return null;
}

/**
 * Fetches the README.md file from the given owner and repo for the given
 * language.
 * @param {string} owner The owner of the tooth.
 * @param {string} repo The name of the tooth.
 * @param {string} versionString The version string.
 * @param {string|undefined} lang The language. If undefined, will fetch the
 *    default README.md file.
 * @return {Promise<string|null>} The content of the README.md file.
 */
async function fetchReadmeForLang(owner, repo, versionString, lang) {
  const readmeUrl = (lang === undefined) ?
      `https://raw.githubusercontent.com/${owner}/${repo}/v${
          versionString}/README.md` :
      `https://raw.githubusercontent.com/${owner}/${repo}/v${
          versionString}/README.${lang}.md`;

  const response = await fetch(readmeUrl);
  consola.log(
      `FETCH GET ${readmeUrl} ${response.status} ${response.statusText}`);
  if (!response.ok) {
    return null;
  }

  return await response.text();
}

/**
 * Fetches the tooth.json file from the given owner and repo. Then converts it
 * to a ToothMetadata object.
 * @param {string} owner The owner of the tooth.
 * @param {string} repo The name of the tooth.
 * @param {string} versionString The version string.
 * @return {Promise<import('../lib/tooth_metadata.js').ToothMetadata>} The tooth
 *     metadata.
 */
async function fetchToothMetadata(owner, repo, versionString) {
  const toothJsonUrl = `https://raw.githubusercontent.com/${owner}/${repo}/v${
      versionString}/tooth.json`;

  const response = await fetch(toothJsonUrl);
  consola.log(
      `FETCH GET ${toothJsonUrl} ${response.status} ${response.statusText}`);
  if (!response.ok) {
    throw httpErrors(
        response.status,
        `Failed to fetch tooth.json: ${await response.text()}`);
  }

  const toothMetadata =
      createToothMetadataFromJsonString(await response.text());

  return toothMetadata;
}

/**
 * Fetches the list of available versions from the given owner and repo.
 * @param {string} owner The owner of the tooth.
 * @param {string} repo The name of the tooth.
 * @return {Promise<Array<string>>} The list of available versions.
 */
async function fetchVersionList(owner, repo) {
  const versionListUrl =
      `https://goproxy.io/github.com/${owner}/${repo}/@v/list`;

  const response = await fetch(versionListUrl);
  consola.log(
      `FETCH GET ${versionListUrl} ${response.status} ${response.statusText}`);
  if (!response.ok) {
    throw httpErrors(
        response.status,
        `Failed to fetch version list: ${await response.text()}`);
  }

  const goTagList = (await response.text())
                        .split('\n')
                        .slice(0, -1);  // Remove the last empty line.

  // Remove prefix 'v' and suffix '+incompatible'.
  const versionList = goTagList.map((tag) => {
    return tag.replace(/^v/, '').replace(/\+incompatible$/, '');
  });

  return versionList;
}
