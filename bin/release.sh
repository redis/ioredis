[ -z "$CONVENTIONAL_GITHUB_RELEASER_TOKEN" ] && echo "Need to set Token" && exit 1;
[ -z "$1" ] && echo "Need to set version bump type" && exit 1;
cp package.json _package.json &&
cp package-lock.json _package-lock.json &&
bump=$1 &&
echo ${1:-$bump} &&
npm --no-git-tag-version version ${1:-$bump} &>/dev/null &&
conventional-changelog -i Changelog.md -s -p angular &&
git add Changelog.md &&
version=`cat package.json | json version` &&
git commit -m"docs(CHANGELOG): $version" &&
mv -f _package.json package.json &&
mv -f _package-lock.json package-lock.json &&
npm version ${1:-$bump} -m "chore(release): %s" &&
git push --follow-tags &&
conventional-github-releaser -p angular &&
npm publish
