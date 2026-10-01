package com.example

import com.example.util.Helper
import com.example.lib._
import com.example.shared.{A, B}

object Main:
  def run(): Unit =
    val h = Helper("hi")
    Logger.log(h.shout())
    A.thing()
    B.thing()
