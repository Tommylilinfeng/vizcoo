<?php
namespace App\Util;

use App\Lib\Logger;

class Helper {
    public function __construct(private string $s) {}
    public function shout(): string {
        Logger::log("shouting");
        return strtoupper($this->s);
    }
}
