local util = require('util')

local M = {}
function M.greet() return util.shout('hello') end
return M
