const express = require("express");
const redis = require("../redis");
const router = express.Router();

/* GET users listing. */
router.get("/", async (req, res) => {
  const users = await redis.lrange("my-users", 0, -1);
  res.render("users", { users });
});

/* POST create a user. */
router.post("/", async (req, res) => {
  await redis.lpush("my-users", req.body.name);
  res.redirect("/");
});

module.exports = router;
