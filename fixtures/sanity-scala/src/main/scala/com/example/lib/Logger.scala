package com.example.lib

import com.example.util.Helper

object Logger:
  def log(msg: String): Unit = println(Helper(msg).shout())
