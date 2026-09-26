#pragma once

#include <sqlite3.h>

#include <stdexcept>
#include <string>
#ifdef LMT_STORAGE_TESTING
#include <functional>
#endif

namespace lmt::sqlite {

#ifdef LMT_STORAGE_TESTING
inline thread_local std::function<bool(const char*)> faultOperation;
inline void injectFault(const char* operation) {
    if (faultOperation && faultOperation(operation)) {
        throw std::runtime_error(std::string("Injected SQLite failure: ") + operation);
    }
}
#else
inline void injectFault(const char*) {}
#endif

class Error : public std::runtime_error {
public:
    explicit Error(const std::string& operation, int code)
        : std::runtime_error(operation + " failed: " + sqlite3_errstr(code)),
          m_code(code) {}
    int code() const noexcept { return m_code; }
private:
    int m_code;
};

inline void check(int code, const char* operation) {
    if (code != SQLITE_OK) throw Error(operation, code);
}

inline void execute(sqlite3* db, const char* sql, const char* operation) {
    injectFault(operation);
    check(sqlite3_exec(db, sql, nullptr, nullptr, nullptr), operation);
}

class Statement {
public:
    Statement(sqlite3* db, const char* sql) {
        injectFault("prepare statement");
        check(sqlite3_prepare_v2(db, sql, -1, &m_stmt, nullptr), "prepare statement");
        if (!m_stmt) throw std::runtime_error("SQLite prepared an empty statement");
    }
    ~Statement() { sqlite3_finalize(m_stmt); }
    Statement(const Statement&) = delete;
    Statement& operator=(const Statement&) = delete;
    sqlite3_stmt* get() const noexcept { return m_stmt; }
    void text(int index, const std::string& value) {
        check(sqlite3_bind_text(m_stmt, index, value.c_str(), -1, SQLITE_TRANSIENT), "bind text");
    }
    void integer(int index, int value) {
        check(sqlite3_bind_int(m_stmt, index, value), "bind integer");
    }
    void integer64(int index, sqlite3_int64 value) {
        check(sqlite3_bind_int64(m_stmt, index, value), "bind integer");
    }
    void real(int index, double value) {
        check(sqlite3_bind_double(m_stmt, index, value), "bind real");
    }
    void null(int index) {
        check(sqlite3_bind_null(m_stmt, index), "bind null");
    }
    int step() {
        injectFault("step statement");
        const int code = sqlite3_step(m_stmt);
        if (code != SQLITE_ROW && code != SQLITE_DONE) throw Error("step statement", code);
        return code;
    }
    void done() {
        if (step() != SQLITE_DONE) throw std::runtime_error("SQLite statement returned a row instead of completing");
    }
    void reset() {
        check(sqlite3_reset(m_stmt), "reset statement");
        check(sqlite3_clear_bindings(m_stmt), "clear bindings");
    }
private:
    sqlite3_stmt* m_stmt = nullptr;
};

class Transaction {
public:
    explicit Transaction(sqlite3* db) : m_db(db) {
        execute(db, "BEGIN IMMEDIATE;", "begin transaction");
    }
    ~Transaction() {
        if (m_active) sqlite3_exec(m_db, "ROLLBACK;", nullptr, nullptr, nullptr);
    }
    Transaction(const Transaction&) = delete;
    Transaction& operator=(const Transaction&) = delete;
    void commit() {
        execute(m_db, "COMMIT;", "commit transaction");
        m_active = false;
    }
private:
    sqlite3* m_db;
    bool m_active = true;
};

} // namespace lmt::sqlite
