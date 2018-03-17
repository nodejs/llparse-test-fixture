#include "fixture.h"

void llparse__print_off(llparse_t* s, const char* p, const char* endp) {
  llparse__print(p, endp, "");
}


int llparse__on_span(llparse_t* s, const char* p, const char* endp) {
  return llparse__print_span("span", p, endp);
}
