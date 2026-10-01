<?php
namespace App\Lib;

class Logger {
    public static function log(string $msg): void {
        echo $msg . "\n";
    }
}
