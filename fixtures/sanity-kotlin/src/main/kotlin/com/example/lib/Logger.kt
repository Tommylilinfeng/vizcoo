package com.example.lib

import com.example.util.Helper

object Logger {
    fun log(msg: String) {
        println(Helper(msg).shout())
    }
}
