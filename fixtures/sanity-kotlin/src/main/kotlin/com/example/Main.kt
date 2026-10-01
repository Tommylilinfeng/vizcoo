package com.example

import com.example.util.Helper
import com.example.lib.*

fun main() {
    val h = Helper("hello")
    println(h.shout())
    Logger.log("done")
    Other.greet()
}
