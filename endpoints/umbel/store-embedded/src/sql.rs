//! A tiny statement builder: text and its positional parameters grow together, and the reader
//! filter becomes a clause of the same statement.

use rusqlite::types::Value;
use umbel_store::ReaderFilter;

/// A value that binds as a statement parameter.
pub(crate) trait Param {
    fn into_value(self) -> Value;
}

impl Param for &str {
    fn into_value(self) -> Value {
        Value::Text(self.to_owned())
    }
}

impl Param for &String {
    fn into_value(self) -> Value {
        Value::Text(self.clone())
    }
}

impl Param for String {
    fn into_value(self) -> Value {
        Value::Text(self)
    }
}

impl Param for i64 {
    fn into_value(self) -> Value {
        Value::Integer(self)
    }
}

/// SQL text and the parameters its `?` marks take, in order.
pub(crate) struct Sql {
    pub(crate) text: String,
    pub(crate) params: Vec<Value>,
}

impl Sql {
    pub(crate) fn new(text: &str) -> Self {
        Self {
            text: text.to_owned(),
            params: Vec::new(),
        }
    }

    pub(crate) fn push(&mut self, text: &str) -> &mut Self {
        self.text.push_str(text);
        self
    }

    /// Append `?` and remember its value.
    pub(crate) fn bind(&mut self, value: impl Param) -> &mut Self {
        self.text.push('?');
        self.params.push(value.into_value());
        self
    }

    /// Append `(?, ?, ...)` for the values.
    pub(crate) fn bind_list<I, V>(&mut self, values: I) -> &mut Self
    where
        I: IntoIterator<Item = V>,
        V: Param,
    {
        self.text.push('(');
        for (index, value) in values.into_iter().enumerate() {
            if index > 0 {
                self.text.push_str(", ");
            }
            self.bind(value);
        }
        self.text.push(')');
        self
    }

    /// ` AND <exists over an access table>` for `reader`: a semi-join on the reader's tokens.
    /// `table` is the access table, `keys` pairs each of its key columns with the outer
    /// expression it must equal. A derivation read adds nothing; a reader with no tokens reads
    /// nothing.
    pub(crate) fn and_readable(
        &mut self,
        table: &str,
        keys: &[(&str, &str)],
        reader: &ReaderFilter,
    ) -> &mut Self {
        let Some(tokens) = reader.token_list() else {
            return self;
        };
        if tokens.is_empty() {
            return self.push(" AND 0");
        }
        self.push(" AND EXISTS (SELECT 1 FROM ")
            .push(table)
            .push(" ax WHERE ");
        for (column, outer) in keys {
            self.push("ax.")
                .push(column)
                .push(" = ")
                .push(outer)
                .push(" AND ");
        }
        self.push("ax.token IN ");
        self.bind_list(tokens.iter().cloned());
        self.push(")")
    }

    /// ` AND <the document is readable>` for a `documents`-keyed expression.
    pub(crate) fn and_doc_readable(&mut self, doc_expr: &str, reader: &ReaderFilter) -> &mut Self {
        self.and_readable("doc_access", &[("doc", doc_expr)], reader)
    }

    /// ` AND <a node with this id is readable>`: some origin document that produced it is.
    pub(crate) fn and_node_readable(&mut self, id_expr: &str, reader: &ReaderFilter) -> &mut Self {
        let Some(tokens) = reader.token_list() else {
            return self;
        };
        if tokens.is_empty() {
            return self.push(" AND 0");
        }
        self.push(" AND EXISTS (SELECT 1 FROM nodes nx JOIN doc_access ax ON ax.doc = nx.origin WHERE nx.id = ")
            .push(id_expr)
            .push(" AND ax.token IN ");
        self.bind_list(tokens.iter().cloned());
        self.push(")")
    }
}
