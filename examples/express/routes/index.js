const express = require("express");
const redis = require("../redis");
const router = express.Router();

/* GET home page. */
router.get("/", async (req, res) => {
  const count = await redis.llen("my-users");
  res.render("index", { count });
});

module.exports = router;
